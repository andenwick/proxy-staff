import { Worker, Job } from 'bullmq';
import { spawn, ChildProcess, execSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { getConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { getPrismaClient } from '../prisma.js';
import { getRedisConnection, LongTaskJob, SessionEndJob, QueueJob } from './queueService.js';
import {
  registerRunningJob,
  updateJobPid,
  unregisterJob,
  getRunningJob,
} from './jobInterruptService.js';
import { sendProgressUpdate, SendMessageFn } from './progressMessenger.js';
import { generateCliSessionId } from '../claudeCli.js';
import { releaseSessionLease } from '../session.js';
import { getTenantFolderService, getLearningService } from '../index.js';

let worker: Worker<QueueJob> | null = null;
let sendMessageFn: SendMessageFn | null = null;

/**
 * Set the message sending function (injected from MessageProcessor)
 */
export function setSendMessageFn(fn: SendMessageFn): void {
  sendMessageFn = fn;
}

/**
 * Kill a process tree in a cross-platform way
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process already dead
        }
      }, 2000);
    }
  } catch {
    // Process may already be dead
  }
}

/**
 * Refresh session lease to prevent expiration during long jobs
 */
async function refreshSessionLease(sessionId: string): Promise<void> {
  const prisma = getPrismaClient();
  const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  try {
    await prisma.conversationSession.updateMany({
      where: { id: sessionId },
      data: { lease_expires_at: leaseExpiresAt },
    });
    logger.debug({ sessionId }, 'Refreshed session lease');
  } catch (error) {
    logger.warn({ sessionId, error }, 'Failed to refresh session lease');
  }
}

/**
 * Process a session-end learning job
 */
async function processSessionEndJob(job: Job<SessionEndJob>): Promise<{ success: boolean }> {
  const { sessionId, tenantId, senderPhone, reason } = job.data;

  logger.info({ sessionId, tenantId, reason }, 'Processing session end job');

  try {
    const learningService = getLearningService();
    await learningService.triggerConversationEndLearning(tenantId, senderPhone, reason);
    logger.info({ sessionId }, 'Session end learning completed');
    return { success: true };
  } catch (error) {
    logger.error({ sessionId, error }, 'Session end learning failed');
    throw error; // Let BullMQ handle retry
  }
}

/**
 * Process a CLI task job
 */
async function processCliTaskJob(job: Job<LongTaskJob>): Promise<{ success: boolean; result?: string }> {
  const { jobId, tenantId, senderPhone, sessionId, message } = job.data;
  const config = getConfig();
  const prisma = getPrismaClient();
  const startTime = Date.now();

  logger.info({ jobId, tenantId, senderPhone: senderPhone.slice(-4) }, 'Processing async job');

  // Register job as running
  registerRunningJob(tenantId, senderPhone, jobId);

  // Update database status
  await prisma.async_jobs.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      started_at: new Date(),
    },
  });

  // Get CLI session ID
  const cliSession = await prisma.conversationSession.findFirst({
    where: { id: sessionId },
    select: { id: true, reset_timestamp: true },
  });
  const cliSessionId = cliSession
    ? generateCliSessionId(cliSession.id, cliSession.reset_timestamp?.getTime())
    : generateCliSessionId(sessionId);

  const tenantFolder = path.resolve(process.cwd(), 'tenants', tenantId);

  // Initialize tenant folder before spawning CLI
  const tenantFolderService = getTenantFolderService();
  await tenantFolderService.initializeTenantForCli(tenantId);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let cliProcess: ChildProcess | null = null;
    let progressIntervalId: ReturnType<typeof setInterval> | null = null;
    let leaseRefreshIntervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCompleted = false;

    const cleanup = async () => {
      if (progressIntervalId) clearInterval(progressIntervalId);
      if (leaseRefreshIntervalId) clearInterval(leaseRefreshIntervalId);
      if (timeoutId) clearTimeout(timeoutId);
      unregisterJob(tenantId, senderPhone);
      // Release session lease so other messages can use the session
      await releaseSessionLease(sessionId);
    };

    const handleCompletion = async (success: boolean, result?: string, error?: string) => {
      if (isCompleted) return;
      isCompleted = true;
      await cleanup();

      const duration = Date.now() - startTime;

      // Update database
      await prisma.async_jobs.update({
        where: { id: jobId },
        data: {
          status: success ? 'COMPLETED' : 'FAILED',
          completed_at: new Date(),
          output_result: result,
          error_message: error,
        },
      });

      // Send result to user and store to messages table
      if (sendMessageFn) {
        try {
          let messageContent: string | undefined;
          let messageId: string | undefined;

          if (success && result) {
            messageId = await sendMessageFn(tenantId, senderPhone, result);
            messageContent = result;
          } else if (error) {
            // Don't send error messages for cancelled/interrupted jobs
            // These happen when user sends a new message while job is running
            const isCancelled = error.includes('cancelled') ||
                               error.includes('code null') ||
                               error.includes('Job timeout');
            if (!isCancelled) {
              const errorMsg = `Something went wrong: ${error}`;
              messageId = await sendMessageFn(tenantId, senderPhone, errorMsg);
              messageContent = errorMsg;
            }
          }

          // Store outbound message to database (critical for session continuity)
          if (messageId && messageContent) {
            await prisma.messages.create({
              data: {
                id: crypto.randomUUID(),
                tenant_id: tenantId,
                sender_phone: senderPhone,
                session_id: sessionId,
                whatsapp_message_id: messageId,
                direction: 'OUTBOUND',
                content: messageContent,
                delivery_status: 'SENT',
              },
            });
            logger.debug({ jobId, sessionId }, 'Stored outbound message to database');
          }
        } catch (msgError) {
          logger.error({ jobId, msgError }, 'Failed to send result to user');
        }
      }

      logger.info({ jobId, success, duration }, 'Job completed');
      resolve({ success, result });
    };

    // Check if job was cancelled before we started processing
    const runningJobInfo = getRunningJob(tenantId, senderPhone);
    if (!runningJobInfo || runningJobInfo.jobId !== jobId) {
      handleCompletion(false, undefined, 'Job cancelled before processing');
      return;
    }

    // Set up max runtime timeout
    timeoutId = setTimeout(async () => {
      logger.warn({ jobId }, 'Job exceeded max runtime, killing');
      if (cliProcess) killProcessTree(cliProcess);

      if (sendMessageFn) {
        try {
          await sendMessageFn(
            tenantId,
            senderPhone,
            '⏱️ This is taking too long. Try a simpler request.'
          );
        } catch {
          // Non-critical: best effort to notify user
        }
      }

      handleCompletion(false, undefined, 'Job timeout exceeded');
    }, config.queue.maxJobRuntimeMs);

    // Set up progress updates (every 60 seconds)
    progressIntervalId = setInterval(async () => {
      // Check if job was cancelled
      const currentJob = getRunningJob(tenantId, senderPhone);
      if (!currentJob || currentJob.jobId !== jobId) {
        if (cliProcess) killProcessTree(cliProcess);
        handleCompletion(false, undefined, 'Job cancelled');
        return;
      }

      const elapsed = Date.now() - startTime;

      // Increment progress counter
      await prisma.async_jobs.update({
        where: { id: jobId },
        data: { progress_updates: { increment: 1 } },
      });

      // Send progress update
      if (sendMessageFn) {
        await sendProgressUpdate(tenantId, senderPhone, elapsed, sendMessageFn);
      }
    }, config.queue.progressUpdateIntervalMs);

    // Set up session lease refresh (every 2 minutes)
    leaseRefreshIntervalId = setInterval(() => {
      refreshSessionLease(sessionId);
    }, 2 * 60 * 1000);

    // Helper to spawn CLI with given session flag
    const spawnCli = (sessionFlag: string) => {
      const config = getConfig();
      const args = ['-p', '--model', config.claudeModel, sessionFlag, cliSessionId, '--setting-sources', 'user,project,local', '--dangerously-skip-permissions'];

      // HOME must be set explicitly for Claude CLI to find credentials on Linux containers
      const proc = spawn('claude', args, {
        cwd: tenantFolder,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: {
          ...process.env,
          TENANT_ID: tenantId,
          SENDER_PHONE: senderPhone,
          API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
          HOME: process.env.HOME || '/home/nodejs',
        },
      });

      return proc;
    };

    let hasRetried = false;

    const startCli = (sessionFlag: string) => {
      stdout = '';
      stderr = '';
      cliProcess = spawnCli(sessionFlag);

      // Update PID for interrupt service
      if (cliProcess.pid) {
        updateJobPid(tenantId, senderPhone, cliProcess.pid);
      }

      cliProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      cliProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      cliProcess.on('close', (code: number | null) => {
        if (code === 0) {
          handleCompletion(true, stdout.trim());
        } else {
          const errorMsg = stderr.trim() || stdout.trim() || `CLI exited with code ${code}`;

          // If --resume failed with "No conversation found", retry with --session-id
          if (!hasRetried && errorMsg.includes('No conversation found')) {
            hasRetried = true;
            logger.info({ jobId, cliSessionId }, 'No existing CLI session, creating new one');
            startCli('--session-id');
            return;
          }

          handleCompletion(false, undefined, errorMsg);
        }
      });

      cliProcess.on('error', (error: Error) => {
        handleCompletion(false, undefined, error.message);
      });

      // Send message to CLI
      cliProcess.stdin?.write(message);
      cliProcess.stdin?.end();
    };

    // Start with --resume, will fallback to --session-id if needed
    startCli('--resume');
  });
}

/**
 * Start the queue worker
 */
export function startWorker(): Worker<QueueJob> | null {
  const config = getConfig();

  if (!config.queue.workerEnabled) {
    logger.info('Queue worker disabled by configuration');
    return null;
  }

  const connection = getRedisConnection();

  worker = new Worker<QueueJob>(
    'async-tasks',
    async (job) => {
      // Route by job name
      if (job.name === 'session-end') {
        return await processSessionEndJob(job as Job<SessionEndJob>);
      }

      // Default: CLI task
      try {
        const result = await processCliTaskJob(job as Job<LongTaskJob>);
        if (!result.success) {
          throw new Error(result.result || 'Job failed');
        }
        return result;
      } catch (error) {
        const jobData = job.data as LongTaskJob;
        logger.error({ jobId: jobData.jobId, error }, 'Job processing failed');
        throw error;
      }
    },
    {
      connection,
      concurrency: config.queue.concurrency,
    }
  );

  worker.on('completed', (job) => {
    const jobData = job.data;
    const jobId = jobData.type === 'cli-task' ? jobData.jobId : jobData.sessionId;
    logger.info({ jobId, type: jobData.type }, 'Job completed successfully');
  });

  worker.on('failed', (job, err) => {
    const jobData = job?.data;
    const jobId = jobData?.type === 'cli-task' ? jobData.jobId : jobData?.sessionId;
    logger.error({ jobId, type: jobData?.type, error: err.message }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ error: err }, 'Worker error');
  });

  logger.info({ concurrency: config.queue.concurrency }, 'Queue worker started');

  return worker;
}

/**
 * Stop the queue worker
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Queue worker stopped');
  }
}

/**
 * Pause the worker (stop accepting new jobs)
 */
export async function pauseWorker(): Promise<void> {
  if (worker) {
    await worker.pause();
    logger.info('Queue worker paused');
  }
}

/**
 * Resume the worker
 */
export async function resumeWorker(): Promise<void> {
  if (worker) {
    await worker.resume();
    logger.info('Queue worker resumed');
  }
}

/**
 * Check if worker is running
 */
export function isWorkerRunning(): boolean {
  return worker !== null && worker.isRunning();
}

/**
 * Get worker instance
 */
export function getWorker(): Worker<QueueJob> | null {
  return worker;
}
