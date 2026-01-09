import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient, MessageDirection, DeliveryStatus, OnboardingStatus } from '@prisma/client';
import { WhatsAppService } from './whatsapp.js';
import { MessagingServiceResolver } from './messaging/resolver.js';
import { ClaudeCliService } from './claudeCli.js';
import { TenantFolderService } from './tenantFolder.js';
import { LearningService } from './learningService.js';
import { TimelineService } from './timelineService.js';
import { getOrCreateSession, endSession, createSession } from './session.js';
import { logger } from '../utils/logger.js';
import {
  ClaudeAPIError,
  ClaudeCliError,
  ToolExecutionError,
} from '../errors/index.js';
import { incrementCounter, recordTiming } from '../utils/metrics.js';
import { getFeedbackCollector } from './index.js';
import {
  getSession,
  createSession as createCliSession,
  injectMessage,
  closeSession as closeCliSession,
  hasSession,
} from './queue/cliSessionStore.js';

// Maximum message content length (WhatsApp limit is 4096, we add buffer for safety)
const MAX_MESSAGE_LENGTH = 4096;

export interface ProcessMessageResult {
  success: boolean;
  replyMessageId?: string;
  error?: string;
  queued?: boolean;  // true if task was queued for async processing
}

/**
 * Interface for CLI session reset capability.
 * Used to allow MessageProcessor to reset CLI sessions without tight coupling.
 */
export interface CliSessionResetter {
  resetSession(tenantId: string, senderPhone: string): Promise<void>;
}

export class MessageProcessor {
  private prisma: PrismaClient;
  private whatsappService: WhatsAppService;
  private messagingResolver: MessagingServiceResolver | null;
  private claudeCliService: ClaudeCliService;
  private tenantFolderService: TenantFolderService;
  private learningService: LearningService | null;
  private timelineService: TimelineService | null;

  constructor(
    prisma: PrismaClient,
    whatsappService: WhatsAppService,
    claudeCliService: ClaudeCliService,
    tenantFolderService: TenantFolderService,
    messagingResolver?: MessagingServiceResolver,
    learningService?: LearningService,
    timelineService?: TimelineService
  ) {
    this.prisma = prisma;
    this.whatsappService = whatsappService;
    this.messagingResolver = messagingResolver || null;
    this.claudeCliService = claudeCliService;
    this.tenantFolderService = tenantFolderService;
    this.learningService = learningService || null;
    this.timelineService = timelineService || null;
  }

  /**
   * Send a message to a tenant's user, using the appropriate channel (WhatsApp or Telegram)
   */
  private async sendMessage(tenantId: string, senderPhone: string, message: string): Promise<string> {
    // If messaging resolver is available, use it to route to the correct channel
    if (this.messagingResolver) {
      const service = await this.messagingResolver.resolveForTenant(tenantId);
      const recipientId = await this.messagingResolver.getRecipientId(tenantId, senderPhone);
      return await service.sendTextMessage(recipientId, message);
    }

    // Fallback to direct WhatsApp service (backward compatibility)
    return await this.whatsappService.sendTextMessage(senderPhone, message);
  }

  /**
   * Process an incoming WhatsApp message and generate a response.
   */
  async processIncomingMessage(
    tenantId: string,
    senderPhone: string,
    messageContent: string,
    whatsappMessageId: string
  ): Promise<ProcessMessageResult> {
    const startMs = Date.now();
    let status: 'success' | 'error' = 'success';

    // Sanitize phone for logging (show last 4 digits only)
    const sanitizedPhone = senderPhone.length > 4
      ? `***${senderPhone.slice(-4)}`
      : '****';

    // Validate message content length
    if (messageContent.length > MAX_MESSAGE_LENGTH) {
      logger.warn({ tenantId, senderPhone: sanitizedPhone, length: messageContent.length }, 'Message exceeds maximum length');
      try {
        await this.sendMessage(tenantId, senderPhone, 'Your message is too long. Please keep it under 4000 characters.');
      } catch {
        // Ignore send errors for validation messages
      }
      return { success: false, error: 'Message exceeds maximum length' };
    }

    // Validate message is not empty (after trimming whitespace)
    if (!messageContent.trim()) {
      logger.debug({ tenantId, senderPhone: sanitizedPhone }, 'Empty message received, ignoring');
      return { success: false, error: 'Empty message' };
    }

    try {
      // Get or create database session (auto-expires after 24 hours of inactivity)
      const { sessionId, isNew } = await getOrCreateSession(tenantId, senderPhone);

      // If a new session was created (old one expired), trigger learning then sync CLI session
      // Skip learning if we just interrupted a job - that's not a natural conversation end
      if (isNew && this.claudeCliService) {
        // Trigger end-of-conversation learning BEFORE resetting CLI
        // CLI still has context from expired session at this point
        if (this.learningService) {
          await this.learningService.triggerConversationEndLearning(tenantId, senderPhone, 'expiry');
        }
        await this.claudeCliService.resetSession(tenantId, senderPhone);
        logger.info({ tenantId, senderPhone: sanitizedPhone }, 'CLI session synced with new database session (after learning)');
      }

      incrementCounter('messages_inbound', { tenantId });

      // Handle /reset and /new commands (both start fresh session)
      const normalizedCommand = messageContent.trim().toLowerCase();
      if (normalizedCommand === '/reset' || normalizedCommand === '/new') {
        return await this.handleResetCommand(tenantId, senderPhone, whatsappMessageId, sessionId, normalizedCommand);
      }

      // Handle /reonboard command (reset to discovery mode)
      if (normalizedCommand === '/reonboard') {
        return await this.handleReonboardCommand(tenantId, senderPhone, whatsappMessageId, sessionId);
      }

      // Handle /cancel command (cancel running async job)
      if (normalizedCommand === '/cancel') {
        return await this.handleCancelCommand(tenantId, senderPhone, whatsappMessageId, sessionId);
      }

      // Store inbound message
      await this.storeMessage({
        tenantId,
        senderPhone,
        sessionId,
        whatsappMessageId,
        direction: 'INBOUND',
        content: messageContent,
        deliveryStatus: 'DELIVERED',
      });

      // Log to timeline (non-blocking)
      if (this.timelineService) {
        this.timelineService.logMessage(tenantId, 'inbound', messageContent, sanitizedPhone)
          .catch(err => logger.error({ err, tenantId }, 'Timeline logging failed'));
      }

      // Initialize tenant folder for CLI (creates CLAUDE.md, settings.json, shared_tools)
      await this.tenantFolderService.initializeTenantForCli(tenantId);

      // Sync context files for continuity on new sessions
      if (isNew) {
        await this.tenantFolderService.syncRecentMessages(tenantId);
        await this.tenantFolderService.syncActivityLog(tenantId);
      }

      // Check onboarding status and prepend context if needed
      const onboardingStatus = await this.getOnboardingStatus(tenantId);
      const onboardingContext = this.buildOnboardingContext(onboardingStatus);

      // Get campaign status for context awareness
      const campaignContext = await this.tenantFolderService.getCampaignStatusContext(tenantId);

      // Build full context: campaign status + onboarding + message
      const messageWithContext = campaignContext + onboardingContext + messageContent;

      // --- CLI Session Injection ---
      // Get or create a persistent CLI session for this user
      let cliSession = getSession(tenantId, senderPhone);

      if (!cliSession) {
        // Create new CLI session
        logger.info({ tenantId, senderPhone: sanitizedPhone }, 'Creating new CLI session');
        cliSession = await createCliSession(tenantId, senderPhone, sessionId);
      }

      // Inject message into CLI session and wait for response
      const response = await injectMessage(cliSession, messageWithContext);

      // Send reply via appropriate channel (WhatsApp or Telegram)
      const replyMessageId = await this.sendMessage(tenantId, senderPhone, response);

      // Store outbound message
      await this.storeMessage({
        tenantId,
        senderPhone,
        sessionId,
        whatsappMessageId: replyMessageId,
        direction: 'OUTBOUND',
        content: response,
        deliveryStatus: 'SENT',
      });

      // Log to timeline (non-blocking)
      if (this.timelineService) {
        this.timelineService.logMessage(tenantId, 'outbound', response, sanitizedPhone)
          .catch(err => logger.error({ err, tenantId }, 'Timeline logging failed'));
      }

      // Record feedback signals (non-blocking)
      try {
        const feedbackCollector = getFeedbackCollector();
        await feedbackCollector.analyzeUserMessage(tenantId, sessionId, messageContent);
      } catch (error) {
        logger.warn({ error }, 'Failed to analyze user message for feedback');
      }

      logger.info({
        tenantId,
        senderPhone,
        inboundMessageId: whatsappMessageId,
        outboundMessageId: replyMessageId,
      }, 'Message processed successfully');

      return { success: true, replyMessageId };
    } catch (error) {
      status = 'error';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      const stack = error instanceof Error ? error.stack : undefined;

      // Log with error categorization
      logger.error({
        errorType,
        tenantId,
        senderPhone: sanitizedPhone,
        message: errorMessage,
        stack,
      }, 'Failed to process message');

      // Determine user-facing message based on error type
      let userMessage: string;
      if (error instanceof ClaudeAPIError) {
        userMessage = "I'm temporarily unavailable. Please try again in a moment.";
      } else if (error instanceof ClaudeCliError) {
        // Check if it's a timeout
        if (error.message.includes('timed out')) {
          userMessage = "That took too long to process. Try a simpler request.";
        } else {
          userMessage = "I had trouble processing that. Please try again.";
        }
      } else if (error instanceof ToolExecutionError) {
        userMessage = "I couldn't complete that action. Please try again or rephrase your request.";
      } else {
        userMessage = "Something went wrong. Please try again.";
      }

      // Try to send error message to user
      try {
        await this.sendMessage(tenantId, senderPhone, userMessage);
      } catch {
        logger.error({ tenantId, senderPhone: sanitizedPhone }, 'Failed to send error message to user');
      }

      return { success: false, error: errorMessage };
    } finally {
      recordTiming('message_processing_ms', Date.now() - startMs, { status });
      incrementCounter('messages_processed', { status, tenantId });
    }
  }

  /**
   * Execute a scheduled task via CLI.
   * Used by SchedulerService for running scheduled tasks.
   *
   * @param tenantId - The tenant ID
   * @param userPhone - The user's phone number
   * @param taskPrompt - The task prompt to execute
   * @returns The response text from Claude
   */
  async executeScheduledTask(
    tenantId: string,
    userPhone: string,
    taskPrompt: string,
    taskType: string = 'reminder',
    previousOutputs: string[] = []
  ): Promise<string> {
    const startMs = Date.now();

    logger.info({ tenantId, userPhone, taskPrompt: taskPrompt.substring(0, 50), taskType }, 'Executing scheduled task via CLI');

    // Initialize tenant folder for CLI
    await this.tenantFolderService.initializeTenantForCli(tenantId);

    // Use the task prompt directly - it was crafted with full context at creation time
    let contextualPrompt = taskPrompt;

    // For recurring tasks, append previous outputs for continuity
    if (previousOutputs.length > 0) {
      const outputList = previousOutputs.map((o, i) => `Run ${i + 1}: ${o}`).join('\n');
      contextualPrompt += `\n\n[PREVIOUS OUTPUTS]\nYour last ${previousOutputs.length} outputs for this recurring task:\n${outputList}\nContinue from where you left off.`;
    }

    // Execute via CLI
    const response = await this.claudeCliService.sendMessage(
      tenantId,
      userPhone,
      contextualPrompt
    );

    logger.info({ tenantId, userPhone, responseLength: response.length }, 'Scheduled task executed successfully');
    recordTiming('scheduled_task_execution_ms', Date.now() - startMs, { taskType });

    return response;
  }

  /**
   * Draft an email reply using the agent.
   * Used by ReplyProcessingService for personalized responses.
   *
   * @param tenantId - The tenant ID
   * @param context - Prospect and reply context
   * @returns The drafted email body, or null if drafting failed
   */
  async draftEmailReply(
    tenantId: string,
    context: {
      prospectName: string;
      prospectCompany?: string;
      prospectTitle?: string;
      prospectEmail: string;
      replySubject: string;
      replyBody: string;
      intent: string;
      campaignName: string;
      businessContext?: string;
      interactionHistory?: string;
    }
  ): Promise<string | null> {
    const startMs = Date.now();

    logger.info({ tenantId, prospectEmail: context.prospectEmail, intent: context.intent }, 'Drafting email reply via agent');

    // Initialize tenant folder
    await this.tenantFolderService.initializeTenantForCli(tenantId);

    // Build the prompt with full context
    const prompt = `[EMAIL REPLY DRAFTING]
You are drafting a response to a prospect's email reply.

PROSPECT:
- Name: ${context.prospectName}
- Company: ${context.prospectCompany || 'Unknown'}
- Title: ${context.prospectTitle || 'Unknown'}
- Email: ${context.prospectEmail}
${context.businessContext ? `\nBusiness Context:\n${context.businessContext}\n` : ''}
${context.interactionHistory ? `\nInteraction History:\n${context.interactionHistory}\n` : ''}

CAMPAIGN: ${context.campaignName}

THEIR REPLY:
Subject: ${context.replySubject}
---
${context.replyBody}
---

DETECTED INTENT: ${context.intent}

INSTRUCTIONS:
1. Write a personalized response that matches your voice (concise, professional, helpful)
2. Reference specific details from their reply and what you know about them
3. Guide toward booking a discovery call naturally
4. Keep it under 150 words
5. No generic templates - make it feel personal
6. Do NOT include the subject line - just the email body
7. Do NOT include a signature - it will be added automatically

Draft the email body now:`;

    try {
      // Get tenant's user phone (use a system phone for scheduled tasks)
      const systemPhone = 'system';

      const response = await this.claudeCliService.sendMessage(
        tenantId,
        systemPhone,
        prompt
      );

      // Clean up the response (remove any extra formatting)
      const cleanedResponse = response.trim();

      logger.info({ tenantId, responseLength: cleanedResponse.length }, 'Email reply drafted successfully');
      recordTiming('email_draft_ms', Date.now() - startMs);

      return cleanedResponse;
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to draft email reply via agent');
      return null;
    }
  }

  private async handleResetCommand(
    tenantId: string,
    senderPhone: string,
    whatsappMessageId: string,
    currentSessionId: string,
    command: string
  ): Promise<ProcessMessageResult> {
    // Store the reset command in current session
    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: currentSessionId,
      whatsappMessageId,
      direction: 'INBOUND',
      content: command,
      deliveryStatus: 'DELIVERED',
    });

    // Trigger end-of-conversation learning BEFORE resetting session
    // This allows Claude to reflect on the conversation while context is still available
    if (this.learningService) {
      await this.learningService.triggerConversationEndLearning(tenantId, senderPhone, 'reset');
    }

    // End current database session and create a new one
    await endSession(currentSessionId);
    const newSessionId = await createSession(tenantId, senderPhone);

    // Close CLI session so next message creates a fresh one
    try {
      await closeCliSession(tenantId, senderPhone);
      logger.info({ tenantId, senderPhone }, 'CLI session closed along with database session');
    } catch (error) {
      logger.error({ tenantId, senderPhone, error }, 'Failed to close CLI session, continuing anyway');
      // Continue - database session is already ended, next message will create new CLI session
    }

    const replyMessageId = await this.sendMessage(
      tenantId,
      senderPhone,
      'Conversation reset. How can I help you?'
    );

    // Store reply in the NEW session
    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: newSessionId,
      whatsappMessageId: replyMessageId,
      direction: 'OUTBOUND',
      content: 'Conversation reset. How can I help you?',
      deliveryStatus: 'SENT',
    });

    logger.info({ tenantId, senderPhone, oldSessionId: currentSessionId, newSessionId }, 'Conversation reset - new session created');

    return { success: true, replyMessageId };
  }

  private async handleReonboardCommand(
    tenantId: string,
    senderPhone: string,
    whatsappMessageId: string,
    currentSessionId: string
  ): Promise<ProcessMessageResult> {
    // Store the command
    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: currentSessionId,
      whatsappMessageId,
      direction: 'INBOUND',
      content: '/reonboard',
      deliveryStatus: 'DELIVERED',
    });

    // Reset onboarding status to DISCOVERY
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { onboarding_status: 'DISCOVERY' },
    });

    logger.info({ tenantId, senderPhone }, 'Onboarding reset to DISCOVERY');

    const replyMessage = "Onboarding reset! I'll start getting to know you again. Let's begin - what should I call you?";

    const replyMessageId = await this.sendMessage(tenantId, senderPhone, replyMessage);

    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: currentSessionId,
      whatsappMessageId: replyMessageId,
      direction: 'OUTBOUND',
      content: replyMessage,
      deliveryStatus: 'SENT',
    });

    return { success: true, replyMessageId };
  }

  private async handleCancelCommand(
    tenantId: string,
    senderPhone: string,
    whatsappMessageId: string,
    currentSessionId: string
  ): Promise<ProcessMessageResult> {
    // Store the command
    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: currentSessionId,
      whatsappMessageId,
      direction: 'INBOUND',
      content: '/cancel',
      deliveryStatus: 'DELIVERED',
    });

    // Try to cancel CLI session (closes stdin, kills process)
    let replyMessage: string;
    if (hasSession(tenantId, senderPhone)) {
      await closeCliSession(tenantId, senderPhone);
      replyMessage = '✅ Task cancelled. What else can I help with?';
      logger.info({ tenantId, senderPhone }, 'CLI session cancelled via /cancel command');
    } else {
      replyMessage = 'No task running to cancel.';
      logger.debug({ tenantId, senderPhone }, 'No active CLI session to cancel');
    }

    const replyMessageId = await this.sendMessage(tenantId, senderPhone, replyMessage);

    await this.storeMessage({
      tenantId,
      senderPhone,
      sessionId: currentSessionId,
      whatsappMessageId: replyMessageId,
      direction: 'OUTBOUND',
      content: replyMessage,
      deliveryStatus: 'SENT',
    });

    return { success: true, replyMessageId };
  }

  private async storeMessage(data: {
    tenantId: string;
    senderPhone: string;
    sessionId: string;
    whatsappMessageId: string;
    direction: MessageDirection;
    content: string;
    deliveryStatus: DeliveryStatus;
  }): Promise<void> {
    await this.prisma.messages.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: data.tenantId,
        sender_phone: data.senderPhone,
        session_id: data.sessionId,
        whatsapp_message_id: data.whatsappMessageId,
        direction: data.direction,
        content: data.content,
        delivery_status: data.deliveryStatus,
      },
    });
  }

  /**
   * Get tenant's onboarding status and sync from file if needed
   */
  private async getOnboardingStatus(tenantId: string): Promise<OnboardingStatus> {
    // Check for sync file from Python tool
    const tenantFolder = this.tenantFolderService.getTenantFolder(tenantId);
    const syncFile = path.join(tenantFolder, 'life', '.onboarding_sync');

    try {
      const syncData = await fs.readFile(syncFile, 'utf-8');
      const { status } = JSON.parse(syncData);

      // Update database with new status
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { onboarding_status: status as OnboardingStatus },
      });

      // Delete sync file after processing
      await fs.unlink(syncFile);

      logger.info({ tenantId, status }, 'Synced onboarding status from file');
      return status as OnboardingStatus;
    } catch {
      // No sync file or error reading - get from database
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { onboarding_status: true },
    });

    return tenant?.onboarding_status || 'DISCOVERY';
  }

  /**
   * Build onboarding context prefix for Claude
   */
  private buildOnboardingContext(status: OnboardingStatus): string {
    if (status === 'LIVE' || status === 'PAUSED') {
      return ''; // No onboarding context needed
    }

    if (status === 'DISCOVERY') {
      return `[ONBOARDING: DISCOVERY MODE]
You are in onboarding mode. Read life/onboarding.md for guidance on what questions to ask.
- Weave discovery questions naturally into the conversation
- Save answers immediately using life_write.py
- Track progress using mark_question_answered.py
- When enough questions are answered, use update_onboarding_status.py to move to BUILDING

User message: `;
    }

    if (status === 'BUILDING') {
      return `[ONBOARDING: BUILDING MODE]
You have gathered initial information. Continue learning passively.
- Note any new information the user shares
- Update life files when you learn something new
- Don't actively interrogate - let knowledge come naturally
- When the user seems comfortable, suggest completing onboarding

User message: `;
    }

    return '';
  }
}
