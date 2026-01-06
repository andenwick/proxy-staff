import crypto from 'crypto';
import { PrismaClient, scheduled_tasks } from '@prisma/client';
import * as cron from 'node-cron';
import { MessageProcessor } from './messageProcessor.js';
import { WhatsAppService } from './whatsapp.js';
import { MessagingServiceResolver } from './messaging/resolver.js';
import { calculateNextRun } from './scheduleParser.js';
import { getOrCreateSession, releaseSessionLease } from './session.js';
import { logger } from '../utils/logger.js';
import { incrementCounter, recordTiming, setGauge } from '../utils/metrics.js';
import { getConfig } from '../config/index.js';
import pg from 'pg';
import os from 'os';
import { ToolExecutionError } from '../errors/index.js';

/**
 * SchedulerService polls the database every minute for due scheduled tasks
 * and executes them using the MessageProcessor (DOE-compliant LLM orchestration).
 */
export class SchedulerService {
  private prisma: PrismaClient;
  private messageProcessor: MessageProcessor;
  private whatsappService: WhatsAppService;
  private messagingResolver: MessagingServiceResolver;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private isStopping: boolean = false;
  private runningTasks: Set<string> = new Set();
  private readonly lockKeys = { primary: 7345, secondary: 9913 };
  private readonly leaseOwner: string;
  private readonly leaseTtlSeconds = 300;
  private readonly claimLimit = 50;
  private readonly shutdownTimeoutMs = 30000; // 30 seconds max wait for graceful shutdown
  private readonly overdueThresholdMs = 5 * 60 * 1000; // 5 minutes

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
    this.leaseOwner = `${os.hostname()}-${process.pid}`;
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
   * Check if a task is overdue and return delay in minutes, or null if on-time.
   */
  private getOverdueMinutes(task: scheduled_tasks): number | null {
    const delayMs = Date.now() - task.next_run_at.getTime();
    return delayMs > this.overdueThresholdMs ? Math.round(delayMs / 60000) : null;
  }

  /**
   * Start the scheduler. Creates a cron job that runs every minute.
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('Scheduler already started');
      return;
    }

    logger.info('Starting scheduler service');
    this.cronJob = cron.schedule('* * * * *', () => {
      this.processDueTasks().catch((error) => {
        logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Error in scheduler tick');
      });
    });
    logger.info('Scheduler service started (polling every minute)');

    // Check for due tasks immediately on startup (don't wait for first cron tick)
    this.processDueTasks().catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Error in initial scheduler tick');
    });
  }

  /**
   * Stop the scheduler gracefully. Waits for in-flight tasks to complete.
   * @param force - If true, stop immediately without waiting for tasks
   */
  async stop(force: boolean = false): Promise<void> {
    if (!this.cronJob) {
      return;
    }

    this.isStopping = true;
    this.cronJob.stop();
    this.cronJob = null;
    logger.info({ runningTaskCount: this.runningTasks.size, force }, 'Scheduler stopping');

    if (force || this.runningTasks.size === 0) {
      logger.info('Scheduler service stopped');
      return;
    }

    // Wait for in-flight tasks with timeout
    const startTime = Date.now();
    while (this.runningTasks.size > 0) {
      if (Date.now() - startTime > this.shutdownTimeoutMs) {
        logger.warn(
          { remainingTasks: Array.from(this.runningTasks) },
          'Scheduler shutdown timeout - some tasks still running'
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Scheduler service stopped');
  }

  /**
   * Get count of currently running tasks.
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size;
  }

  /**
   * Process all due tasks. Called every minute by the cron job.
   * Uses isRunning flag to prevent overlapping runs.
   */
  private async processDueTasks(): Promise<void> {
    // Don't start new processing if shutting down
    if (this.isStopping) {
      logger.debug('Scheduler is stopping, skipping this tick');
      return;
    }

    // Prevent overlapping runs
    if (this.isRunning) {
      logger.debug('Scheduler already processing, skipping this tick');
      return;
    }

    this.isRunning = true;
    setGauge('scheduler_last_tick_ms', Date.now());
    const lockClient = await this.acquireSchedulerLock();
    if (!lockClient) {
      this.isRunning = false;
      incrementCounter('scheduler_lock', { status: 'busy' });
      logger.debug('Scheduler lock not acquired, skipping this tick');
      return;
    }
    incrementCounter('scheduler_lock', { status: 'acquired' });

    try {
      const now = new Date();

      const dueTasks = await this.claimDueTasks(now);

      if (dueTasks.length === 0) {
        return;
      }

      logger.info({ taskCount: dueTasks.length }, 'Processing due tasks');

      // Process each task
      for (const task of dueTasks) {
        await this.executeTask(task);
      }
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Error processing due tasks');
    } finally {
      await this.releaseSchedulerLock(lockClient);
      this.isRunning = false;
    }
  }

  private async acquireSchedulerLock(): Promise<pg.Client | null> {
    const config = getConfig();
    const client = new pg.Client({ connectionString: config.databaseUrl });
    try {
      await client.connect();
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [this.lockKeys.primary, this.lockKeys.secondary]
      );

      if (!result.rows[0]?.locked) {
        await client.end();
        return null;
      }

      return client;
    } catch (error) {
      incrementCounter('scheduler_lock', { status: 'error' });
      logger.error({ error }, 'Failed to acquire scheduler lock');
      try {
        await client.end();
      } catch (closeError) {
        logger.debug({ closeError }, 'Failed to close client after lock acquisition error');
      }
      return null;
    }
  }

  private async releaseSchedulerLock(client: pg.Client): Promise<void> {
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [
        this.lockKeys.primary,
        this.lockKeys.secondary,
      ]);
    } catch (error) {
      incrementCounter('scheduler_lock', { status: 'release_error' });
      logger.error({ error }, 'Failed to release scheduler lock');
    } finally {
      await client.end();
    }
  }

  /**
   * Execute a single scheduled task using DOE-compliant LLM orchestration.
   * Claude (Orchestrator) interprets the task and calls Python tools (Executables).
   */
  private async executeTask(task: scheduled_tasks): Promise<void> {
    const taskId = task.id;
    const userPhone = task.user_phone;
    const startMs = Date.now();

    // Track this task as running (for graceful shutdown)
    this.runningTasks.add(taskId);

    try {
      logger.info({ taskId, userPhone, taskPrompt: task.task_prompt.substring(0, 50) }, 'Executing scheduled task');

      // Extract previous outputs from execution_plan for recurring tasks
      let previousOutputs: string[] = [];
      if (!task.is_one_time && task.execution_plan) {
        const plan = task.execution_plan as { previousOutputs?: string[] };
        previousOutputs = plan.previousOutputs || [];
      }

      // Execute via MessageProcessor (DOE: Claude orchestrates, tools execute)
      const response = await this.messageProcessor.executeScheduledTask(
        task.tenant_id,
        task.user_phone,
        task.task_prompt,
        task.task_type,
        previousOutputs
      );

      // Check if task was overdue and prepend notice if so
      const overdueMinutes = this.getOverdueMinutes(task);
      let finalResponse = response;
      if (overdueMinutes !== null) {
        finalResponse = `⏰ Delayed ${overdueMinutes}m - running now:\n\n${response}`;
        logger.info({ taskId, overdueMinutes }, 'Executed overdue task');
      }

      // Send the result to the user via their configured messaging channel
      const messageId = await this.sendMessage(task.tenant_id, userPhone, finalResponse);

      // Save the outbound message to the database
      const { sessionId } = await getOrCreateSession(task.tenant_id, userPhone);
      await this.prisma.messages.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: task.tenant_id,
          sender_phone: userPhone,
          session_id: sessionId,
          whatsapp_message_id: messageId,
          direction: 'OUTBOUND',
          content: finalResponse,
          delivery_status: 'SENT',
        },
      });

      // Release session lease immediately after storing message
      await releaseSessionLease(sessionId);

      // Handle task completion
      if (task.is_one_time) {
        // Delete one-time tasks after successful execution
        await this.prisma.scheduled_tasks.delete({
          where: { id: taskId },
        });
        logger.info({ taskId }, 'One-time task completed and deleted');
      } else {
        // Update recurring tasks with next run time and save output to state
        const nextRunAt = calculateNextRun(task.cron_expr!, task.timezone);

        // Update execution_plan with new output (keep last 5)
        const MAX_STORED_OUTPUTS = 5;
        const updatedOutputs = [...previousOutputs, response].slice(-MAX_STORED_OUTPUTS);

        await this.prisma.scheduled_tasks.update({
          where: { id: taskId },
          data: {
            last_run_at: new Date(),
            next_run_at: nextRunAt,
            error_count: 0, // Reset error count on success
            lease_owner: null,
            lease_expires_at: null,
            execution_plan: { previousOutputs: updatedOutputs },
          },
        });
        logger.info({ taskId, nextRunAt, outputCount: updatedOutputs.length }, 'Recurring task completed, next run scheduled');
      }

      recordTiming('scheduled_task_ms', Date.now() - startMs, { status: 'success', taskType: task.task_type });
      incrementCounter('scheduled_tasks', { status: 'success', taskType: task.task_type });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ taskId, error: errorMessage }, 'Failed to execute scheduled task');
      recordTiming('scheduled_task_ms', Date.now() - startMs, { status: 'error', taskType: task.task_type });
      incrementCounter('scheduled_tasks', { status: 'error', taskType: task.task_type });

      // Increment error count
      const newErrorCount = task.error_count + 1;

      if (newErrorCount === 1) {
        const notice = error instanceof ToolExecutionError
          ? "I couldn't complete your scheduled task because no action was run. I'll retry."
          : "I couldn't complete your scheduled task yet. I'll retry.";

        try {
          const failureMessageId = await this.sendMessage(task.tenant_id, userPhone, notice);
          const { sessionId } = await getOrCreateSession(task.tenant_id, userPhone);
          await this.prisma.messages.create({
            data: {
              id: crypto.randomUUID(),
              tenant_id: task.tenant_id,
              sender_phone: userPhone,
              session_id: sessionId,
              whatsapp_message_id: failureMessageId,
              direction: 'OUTBOUND',
              content: notice,
              delivery_status: 'SENT',
            },
          });
          await releaseSessionLease(sessionId);
        } catch (notifyError) {
          logger.error({ taskId, error: notifyError }, 'Failed to notify user of scheduled task failure');
        }
      }

      if (newErrorCount >= 3) {
        // Disable task after 3 consecutive failures
        await this.prisma.scheduled_tasks.update({
          where: { id: taskId },
          data: {
            error_count: newErrorCount,
            enabled: false,
            lease_owner: null,
            lease_expires_at: null,
          },
        });

        // Notify user via their configured messaging channel
        try {
          await this.sendMessage(
            task.tenant_id,
            userPhone,
            `Your scheduled task "${task.task_prompt.substring(0, 30)}..." has been disabled after 3 consecutive failures. Please reschedule if needed.`
          );
        } catch (notifyError) {
          logger.error({ taskId, error: notifyError }, 'Failed to notify user of task disable');
        }

        logger.warn({ taskId, errorCount: newErrorCount }, 'Task disabled after 3 consecutive failures');
      } else {
        // Update error count and calculate next run time for retry
        const nextRunAt = task.is_one_time
          ? new Date(Date.now() + 60000) // Retry in 1 minute for one-time tasks
          : calculateNextRun(task.cron_expr!, task.timezone);

        await this.prisma.scheduled_tasks.update({
          where: { id: taskId },
          data: {
            error_count: newErrorCount,
            next_run_at: nextRunAt,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        logger.info({ taskId, errorCount: newErrorCount, nextRunAt }, 'Task failed, will retry');
      }
    } finally {
      // Always remove from running tasks set (for graceful shutdown tracking)
      this.runningTasks.delete(taskId);
    }
  }

  private async claimDueTasks(now: Date): Promise<scheduled_tasks[]> {
    const tasks = await this.prisma.$queryRaw<scheduled_tasks[]>`
      UPDATE scheduled_tasks
      SET lease_owner = ${this.leaseOwner},
          lease_expires_at = NOW() + (${this.leaseTtlSeconds} || ' seconds')::interval
      WHERE id IN (
        SELECT id FROM scheduled_tasks
        WHERE enabled = true
          AND next_run_at <= ${now}
          AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        ORDER BY next_run_at ASC
        LIMIT ${this.claimLimit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    if (tasks.length > 0) {
      incrementCounter('scheduled_tasks_claimed', undefined, tasks.length);
    }

    return tasks;
  }
}
