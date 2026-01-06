import crypto from 'crypto';
import { PrismaClient, TriggerType, AutonomyLevel, TriggerStatus, TriggerExecutionStatus, ConfirmationStatus, MessageDirection, DeliveryStatus } from '@prisma/client';
import { MessageProcessor } from './messageProcessor.js';
import { WhatsAppService } from './whatsapp.js';
import { MessagingServiceResolver } from './messaging/resolver.js';
import { getOrCreateSession } from './session.js';
import { logger } from '../utils/logger.js';
import { incrementCounter, recordTiming } from '../utils/metrics.js';
import { encryptCredential, decryptCredential } from '../utils/encryption.js';
import type { EventSourceAdapter, TriggerEvent, TriggerPayload, ParsedCondition, ComparisonOperator } from '../types/trigger.js';

const CONFIRMATION_TIMEOUT_MINUTES = 30;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Interpolate template variables in a string.
 * Replaces {{path.to.value}} with the actual value from the context object.
 */
function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value: unknown = context;
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return match; // Keep original if path not found
      }
    }
    return value !== undefined && value !== null ? String(value) : match;
  });
}

interface CircuitBreakerState {
  failures: number;
  openedAt: number | null;
}

/**
 * TriggerEvaluatorService - Core service for the workflow trigger system.
 * Manages adapters, evaluates triggers, and executes based on autonomy level.
 */
export class TriggerEvaluatorService {
  private prisma: PrismaClient;
  private messageProcessor: MessageProcessor;
  private whatsappService: WhatsAppService;
  private messagingResolver: MessagingServiceResolver;
  private adapters: Map<string, EventSourceAdapter> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private isRunning: boolean = false;

  constructor(
    prisma: PrismaClient,
    messageProcessor: MessageProcessor,
    whatsappService: WhatsAppService,
    messagingResolver: MessagingServiceResolver
  ) {
    this.prisma = prisma;
    this.messageProcessor = messageProcessor;
    this.whatsappService = whatsappService;
    this.messagingResolver = messagingResolver;
  }

  /**
   * Send a message using the tenant's configured messaging channel.
   */
  private async sendMessage(tenantId: string, userPhone: string, message: string): Promise<string> {
    const service = await this.messagingResolver.resolveForTenant(tenantId);
    const recipientId = await this.messagingResolver.getRecipientId(tenantId, userPhone);
    return await service.sendTextMessage(recipientId, message);
  }

  /**
   * Register an event source adapter.
   */
  registerAdapter(adapter: EventSourceAdapter): void {
    if (this.adapters.has(adapter.name)) {
      logger.warn({ adapterName: adapter.name }, 'Adapter already registered, replacing');
    }
    this.adapters.set(adapter.name, adapter);
    adapter.onTrigger(this.handleTriggerEvent.bind(this));
    logger.info({ adapterName: adapter.name }, 'Registered trigger adapter');
  }

  /**
   * Start all registered adapters.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TriggerEvaluator already running');
      return;
    }

    logger.info({ adapterCount: this.adapters.size }, 'Starting TriggerEvaluatorService');

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.start();
        logger.info({ adapterName: name }, 'Started adapter');
      } catch (error) {
        logger.error({ adapterName: name, error }, 'Failed to start adapter');
      }
    }

    this.isRunning = true;
    logger.info('TriggerEvaluatorService started');
  }

  /**
   * Stop all registered adapters.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping TriggerEvaluatorService');

    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.stop();
        logger.info({ adapterName: name }, 'Stopped adapter');
      } catch (error) {
        logger.error({ adapterName: name, error }, 'Failed to stop adapter');
      }
    }

    this.isRunning = false;
    logger.info('TriggerEvaluatorService stopped');
  }

  /**
   * Handle an incoming trigger event from an adapter.
   */
  async handleTriggerEvent(event: TriggerEvent): Promise<void> {
    const { triggerId, tenantId, autonomy, payload } = event;
    const startMs = Date.now();

    logger.info({ triggerId, tenantId, autonomy, source: payload.source }, 'Handling trigger event');

    // Check circuit breaker
    if (this.isCircuitBreakerOpen(triggerId)) {
      logger.warn({ triggerId }, 'Circuit breaker open, skipping trigger');
      incrementCounter('trigger_executions', { status: 'circuit_breaker' });
      return;
    }

    // Load trigger from database to get current state
    const trigger = await this.prisma.triggers.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) {
      logger.error({ triggerId }, 'Trigger not found');
      return;
    }

    // Check if trigger is active
    if (trigger.status !== TriggerStatus.ACTIVE) {
      logger.debug({ triggerId, status: trigger.status }, 'Trigger not active, skipping');
      return;
    }

    // Check cooldown
    if (trigger.last_triggered_at && trigger.cooldown_seconds > 0) {
      const cooldownEnd = new Date(trigger.last_triggered_at.getTime() + trigger.cooldown_seconds * 1000);
      if (new Date() < cooldownEnd) {
        logger.debug({ triggerId, cooldownEnd }, 'Trigger in cooldown period');
        return;
      }
    }

    // Create execution record
    const execution = await this.prisma.trigger_executions.create({
      data: {
        trigger_id: triggerId,
        tenant_id: tenantId,
        status: TriggerExecutionStatus.PENDING,
        triggered_by: payload.source,
        input_context: payload as object,
      },
    });

    try {
      // Execute based on autonomy level
      switch (autonomy) {
        case AutonomyLevel.NOTIFY:
          await this.executeNotify(trigger, event, execution.id);
          break;
        case AutonomyLevel.CONFIRM:
          await this.executeConfirm(trigger, event, execution.id);
          break;
        case AutonomyLevel.AUTO:
          await this.executeAuto(trigger, event, execution.id);
          break;
      }

      // Update trigger state
      await this.prisma.triggers.update({
        where: { id: triggerId },
        data: {
          last_triggered_at: new Date(),
          error_count: 0, // Reset on success
        },
      });

      this.resetCircuitBreaker(triggerId);
      incrementCounter('trigger_executions', { status: 'success', autonomy });
      recordTiming('trigger_execution_ms', Date.now() - startMs, { autonomy });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ triggerId, error: errorMessage }, 'Trigger execution failed');

      // Update execution with error
      await this.prisma.trigger_executions.update({
        where: { id: execution.id },
        data: {
          status: TriggerExecutionStatus.FAILED,
          error_message: errorMessage,
          completed_at: new Date(),
          duration_ms: Date.now() - startMs,
        },
      });

      // Update circuit breaker
      this.recordCircuitBreakerFailure(triggerId);

      // Increment error count
      const newErrorCount = trigger.error_count + 1;
      await this.prisma.triggers.update({
        where: { id: triggerId },
        data: {
          error_count: newErrorCount,
          status: newErrorCount >= trigger.max_errors ? TriggerStatus.ERROR : trigger.status,
        },
      });

      incrementCounter('trigger_executions', { status: 'error', autonomy });
    }
  }

  /**
   * Execute NOTIFY autonomy - Send a message about the event via tenant's channel.
   */
  private async executeNotify(
    trigger: { id: string; name: string; task_prompt: string; tenant_id: string; user_phone: string },
    event: TriggerEvent,
    executionId: string
  ): Promise<void> {
    // Interpolate template variables in task_prompt with payload data
    const interpolatedPrompt = interpolateTemplate(trigger.task_prompt, { payload: event.payload });
    const message = `🔔 Trigger "${trigger.name}": ${event.payload.source}\n\n${interpolatedPrompt}`;

    const messageId = await this.sendMessage(trigger.tenant_id, trigger.user_phone, message);

    // Save message to database
    const { sessionId } = await getOrCreateSession(trigger.tenant_id, trigger.user_phone);
    await this.prisma.messages.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: trigger.tenant_id,
        sender_phone: trigger.user_phone,
        session_id: sessionId,
        whatsapp_message_id: messageId,
        direction: MessageDirection.OUTBOUND,
        content: message,
        delivery_status: DeliveryStatus.SENT,
      },
    });

    // Mark execution complete
    await this.prisma.trigger_executions.update({
      where: { id: executionId },
      data: {
        status: TriggerExecutionStatus.COMPLETED,
        output: 'Notification sent',
        completed_at: new Date(),
      },
    });

    logger.info({ triggerId: trigger.id, executionId }, 'NOTIFY execution completed');
  }

  /**
   * Execute CONFIRM autonomy - Ask user for permission, then execute if approved.
   */
  private async executeConfirm(
    trigger: { id: string; name: string; task_prompt: string; tenant_id: string; user_phone: string },
    event: TriggerEvent,
    executionId: string
  ): Promise<void> {
    const deadline = new Date(Date.now() + CONFIRMATION_TIMEOUT_MINUTES * 60 * 1000);
    // Interpolate template variables in task_prompt with payload data
    const interpolatedPrompt = interpolateTemplate(trigger.task_prompt, { payload: event.payload });
    const message = `⏳ Trigger "${trigger.name}" wants to run:\n\n"${interpolatedPrompt}"\n\nReply YES to approve or NO to cancel.\n(Expires in ${CONFIRMATION_TIMEOUT_MINUTES} min)`;

    const messageId = await this.sendMessage(trigger.tenant_id, trigger.user_phone, message);

    // Save message to database
    const { sessionId } = await getOrCreateSession(trigger.tenant_id, trigger.user_phone);
    await this.prisma.messages.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: trigger.tenant_id,
        sender_phone: trigger.user_phone,
        session_id: sessionId,
        whatsapp_message_id: messageId,
        direction: MessageDirection.OUTBOUND,
        content: message,
        delivery_status: DeliveryStatus.SENT,
      },
    });

    // Update execution with confirmation pending status
    await this.prisma.trigger_executions.update({
      where: { id: executionId },
      data: {
        status: TriggerExecutionStatus.AWAITING_CONFIRMATION,
        confirmation_status: ConfirmationStatus.PENDING,
        confirmation_deadline: deadline,
      },
    });

    logger.info({ triggerId: trigger.id, executionId, deadline }, 'CONFIRM: awaiting user response');
  }

  /**
   * Execute AUTO autonomy - Full Claude CLI execution with DOE framework.
   */
  private async executeAuto(
    trigger: { id: string; name: string; task_prompt: string; tenant_id: string; user_phone: string; execution_state: unknown },
    event: TriggerEvent,
    executionId: string
  ): Promise<void> {
    // Update execution to running
    await this.prisma.trigger_executions.update({
      where: { id: executionId },
      data: { status: TriggerExecutionStatus.RUNNING },
    });

    // Extract previous outputs from execution_state
    let previousOutputs: string[] = [];
    if (trigger.execution_state) {
      const state = trigger.execution_state as { previousOutputs?: string[] };
      previousOutputs = state.previousOutputs || [];
    }

    // Add trigger context to task prompt (interpolate template variables first)
    const interpolatedPrompt = interpolateTemplate(trigger.task_prompt, { payload: event.payload });
    const contextualPrompt = `[TRIGGERED BY: ${event.payload.source}]\n${JSON.stringify(event.payload.data, null, 2)}\n\n${interpolatedPrompt}`;

    // Execute via MessageProcessor
    const response = await this.messageProcessor.executeScheduledTask(
      trigger.tenant_id,
      trigger.user_phone,
      contextualPrompt,
      'trigger',
      previousOutputs
    );

    // Send response to user via their configured messaging channel
    const messageId = await this.sendMessage(trigger.tenant_id, trigger.user_phone, response);

    const { sessionId } = await getOrCreateSession(trigger.tenant_id, trigger.user_phone);
    await this.prisma.messages.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: trigger.tenant_id,
        sender_phone: trigger.user_phone,
        session_id: sessionId,
        whatsapp_message_id: messageId,
        direction: MessageDirection.OUTBOUND,
        content: response,
        delivery_status: DeliveryStatus.SENT,
      },
    });

    // Update execution state with new output (keep last 5)
    const MAX_STORED_OUTPUTS = 5;
    const updatedOutputs = [...previousOutputs, response].slice(-MAX_STORED_OUTPUTS);

    await this.prisma.triggers.update({
      where: { id: trigger.id },
      data: {
        execution_state: { previousOutputs: updatedOutputs },
      },
    });

    // Mark execution complete
    await this.prisma.trigger_executions.update({
      where: { id: executionId },
      data: {
        status: TriggerExecutionStatus.COMPLETED,
        output: response,
        completed_at: new Date(),
      },
    });

    logger.info({ triggerId: trigger.id, executionId }, 'AUTO execution completed');
  }

  /**
   * Handle confirmation response from user (called from WhatsApp handler).
   */
  async handleConfirmationResponse(
    tenantId: string,
    userPhone: string,
    approved: boolean
  ): Promise<{ handled: boolean; message?: string }> {
    // Find pending confirmation for this user
    const execution = await this.prisma.trigger_executions.findFirst({
      where: {
        tenant_id: tenantId,
        confirmation_status: ConfirmationStatus.PENDING,
        confirmation_deadline: { gt: new Date() },
        triggers: {
          user_phone: userPhone,
        },
      },
      include: {
        triggers: true,
      },
      orderBy: {
        started_at: 'desc',
      },
    });

    if (!execution) {
      return { handled: false };
    }

    if (approved) {
      // Update confirmation status
      await this.prisma.trigger_executions.update({
        where: { id: execution.id },
        data: {
          confirmation_status: ConfirmationStatus.APPROVED,
          confirmed_by: userPhone,
          confirmed_at: new Date(),
        },
      });

      // Execute the trigger
      const trigger = execution.triggers;
      const event: TriggerEvent = {
        triggerId: trigger.id,
        tenantId: trigger.tenant_id,
        userPhone: trigger.user_phone,
        triggerType: trigger.trigger_type,
        autonomy: trigger.autonomy,
        taskPrompt: trigger.task_prompt,
        payload: (execution.input_context as unknown as TriggerPayload) || { source: 'confirmation', data: {} },
        timestamp: new Date(),
      };

      try {
        await this.executeAuto(trigger, event, execution.id);
        return { handled: true, message: '✅ Approved! Executing now...' };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { handled: true, message: `❌ Execution failed: ${errorMessage}` };
      }
    } else {
      // Rejected
      await this.prisma.trigger_executions.update({
        where: { id: execution.id },
        data: {
          status: TriggerExecutionStatus.CANCELLED,
          confirmation_status: ConfirmationStatus.REJECTED,
          confirmed_by: userPhone,
          confirmed_at: new Date(),
          completed_at: new Date(),
        },
      });

      return { handled: true, message: '❌ Trigger cancelled.' };
    }
  }

  /**
   * Check if there's a pending confirmation for a user.
   */
  async hasPendingConfirmation(tenantId: string, userPhone: string): Promise<boolean> {
    const count = await this.prisma.trigger_executions.count({
      where: {
        tenant_id: tenantId,
        confirmation_status: ConfirmationStatus.PENDING,
        confirmation_deadline: { gt: new Date() },
        triggers: {
          user_phone: userPhone,
        },
      },
    });
    return count > 0;
  }

  /**
   * Create a webhook trigger and return its URL.
   */
  async createWebhookTrigger(
    tenantId: string,
    userPhone: string,
    name: string,
    taskPrompt: string,
    autonomy: AutonomyLevel = AutonomyLevel.NOTIFY
  ): Promise<{ triggerId: string; webhookUrl: string; webhookSecret: string }> {
    const webhookPath = `${tenantId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const webhookSecret = crypto.randomUUID();
    const encryptedSecret = encryptCredential(webhookSecret);

    const trigger = await this.prisma.triggers.create({
      data: {
        tenant_id: tenantId,
        user_phone: userPhone,
        name,
        trigger_type: TriggerType.WEBHOOK,
        config: { signature_type: 'hmac-sha256', signature_header: 'x-signature' },
        task_prompt: taskPrompt,
        autonomy,
        webhook_path: webhookPath,
        webhook_secret: encryptedSecret,
      },
    });

    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/webhooks/trigger/${webhookPath}`;

    logger.info({ triggerId: trigger.id, webhookUrl }, 'Created webhook trigger');

    return {
      triggerId: trigger.id,
      webhookUrl,
      webhookSecret,
    };
  }

  /**
   * Verify webhook signature.
   */
  verifyWebhookSignature(
    payload: string,
    signature: string,
    encryptedSecret: string,
    signatureType: 'hmac-sha256' | 'hmac-sha1' = 'hmac-sha256'
  ): boolean {
    const secret = decryptCredential(encryptedSecret);

    const algorithm = signatureType === 'hmac-sha256' ? 'sha256' : 'sha1';
    const expectedSignature = crypto
      .createHmac(algorithm, secret)
      .update(payload)
      .digest('hex');

    // Timing-safe comparison
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  /**
   * Safe expression evaluation - NO eval(), only simple comparisons.
   */
  evaluateCondition(expression: string, value: unknown): boolean {
    const parsed = this.parseCondition(expression);
    if (!parsed) {
      logger.warn({ expression }, 'Failed to parse condition expression');
      return false;
    }

    const { operator, right } = parsed;
    const numValue = typeof value === 'number' ? value : parseFloat(String(value));
    const numRight = typeof right === 'number' ? right : parseFloat(String(right));

    switch (operator) {
      case '<':
        return numValue < numRight;
      case '>':
        return numValue > numRight;
      case '<=':
        return numValue <= numRight;
      case '>=':
        return numValue >= numRight;
      case '==':
        return value == right;
      case '!=':
        return value != right;
      case 'contains':
        return String(value).includes(String(right));
      case 'startsWith':
        return String(value).startsWith(String(right));
      case 'endsWith':
        return String(value).endsWith(String(right));
      default:
        return false;
    }
  }

  /**
   * Parse a simple condition expression.
   */
  private parseCondition(expression: string): ParsedCondition | null {
    // Match patterns like: "value < 100", "balance >= 50.5", "status == 'active'"
    const operators: ComparisonOperator[] = ['<=', '>=', '!=', '==', '<', '>', 'contains', 'startsWith', 'endsWith'];

    for (const op of operators) {
      const index = expression.indexOf(op);
      if (index !== -1) {
        const left = expression.substring(0, index).trim();
        let right: string | number | boolean = expression.substring(index + op.length).trim();

        // Parse right side
        if (right.startsWith("'") && right.endsWith("'")) {
          right = right.slice(1, -1); // Remove quotes
        } else if (right === 'true') {
          right = true;
        } else if (right === 'false') {
          right = false;
        } else if (!isNaN(parseFloat(right))) {
          right = parseFloat(right);
        }

        return { left, operator: op, right };
      }
    }

    return null;
  }

  // ==========================================
  // Circuit Breaker Pattern
  // ==========================================

  private isCircuitBreakerOpen(triggerId: string): boolean {
    const state = this.circuitBreakers.get(triggerId);
    if (!state || !state.openedAt) {
      return false;
    }

    // Check if circuit breaker should be reset (after 5 minutes)
    if (Date.now() - state.openedAt > CIRCUIT_BREAKER_RESET_MS) {
      this.circuitBreakers.delete(triggerId);
      return false;
    }

    return true;
  }

  private recordCircuitBreakerFailure(triggerId: string): void {
    const state = this.circuitBreakers.get(triggerId) || { failures: 0, openedAt: null };
    state.failures += 1;

    if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.openedAt = Date.now();
      logger.warn({ triggerId, failures: state.failures }, 'Circuit breaker opened');
    }

    this.circuitBreakers.set(triggerId, state);
  }

  private resetCircuitBreaker(triggerId: string): void {
    this.circuitBreakers.delete(triggerId);
  }
}
