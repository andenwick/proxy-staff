import { execSync } from 'child_process';
import { getPrismaClient } from '../prisma.js';
import { logger } from '../../utils/logger.js';
import { cancelJob, getActiveJobForUser } from './queueService.js';
import { clearUpdateTracking } from './progressMessenger.js';

export type InterruptReason = 'new_message' | 'cancel_command' | 'timeout' | 'shutdown';

export interface InterruptResult {
  interrupted: boolean;
  jobId?: string;
  reason: InterruptReason;
}

// Track running jobs with their PIDs
// Map key: tenantId:senderPhone, value: { jobId, pid }
const runningJobs = new Map<string, { jobId: string; pid?: number }>();

/**
 * Get the key for tracking a user's job
 */
function getUserKey(tenantId: string, senderPhone: string): string {
  return `${tenantId}:${senderPhone}`;
}

/**
 * Kill a process tree in a cross-platform way
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
      // Force kill after 2 seconds
      setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already dead
        }
      }, 2000);
    }
  } catch {
    // Process may already be dead
  }
}

/**
 * Register a running job for a user
 */
export function registerRunningJob(
  tenantId: string,
  senderPhone: string,
  jobId: string,
  pid?: number
): void {
  const key = getUserKey(tenantId, senderPhone);
  runningJobs.set(key, { jobId, pid });
  logger.debug({ tenantId, senderPhone: senderPhone.slice(-4), jobId, pid }, 'Registered running job');
}

/**
 * Update the PID for a running job
 */
export function updateJobPid(tenantId: string, senderPhone: string, pid: number): void {
  const key = getUserKey(tenantId, senderPhone);
  const job = runningJobs.get(key);
  if (job) {
    job.pid = pid;
    logger.debug({ tenantId, senderPhone: senderPhone.slice(-4), jobId: job.jobId, pid }, 'Updated job PID');
  }
}

/**
 * Unregister a completed/cancelled job
 */
export function unregisterJob(tenantId: string, senderPhone: string): void {
  const key = getUserKey(tenantId, senderPhone);
  runningJobs.delete(key);
  clearUpdateTracking(tenantId, senderPhone);
  logger.debug({ tenantId, senderPhone: senderPhone.slice(-4) }, 'Unregistered job');
}

/**
 * Get the active running job for a user (from memory)
 */
export function getRunningJob(tenantId: string, senderPhone: string): { jobId: string; pid?: number } | null {
  const key = getUserKey(tenantId, senderPhone);
  return runningJobs.get(key) || null;
}

/**
 * Check if user has an active job (checks both memory and database)
 */
export async function hasActiveJob(tenantId: string, senderPhone: string): Promise<boolean> {
  // First check memory (faster)
  const running = getRunningJob(tenantId, senderPhone);
  if (running) {
    return true;
  }

  // Then check database (for jobs that may be queued but not yet running)
  const dbJob = await getActiveJobForUser(tenantId, senderPhone);
  return dbJob !== null;
}

/**
 * Interrupt a user's active job
 * Called when user sends a new message or /cancel command
 */
export async function interruptUserJob(
  tenantId: string,
  senderPhone: string,
  reason: InterruptReason
): Promise<InterruptResult> {
  const prisma = getPrismaClient();
  const key = getUserKey(tenantId, senderPhone);

  // Check memory first
  const running = runningJobs.get(key);

  // Also check database for queued (not yet running) jobs
  const dbJob = await getActiveJobForUser(tenantId, senderPhone);

  const jobId = running?.jobId || dbJob?.id;

  if (!jobId) {
    logger.debug({ tenantId, senderPhone: senderPhone.slice(-4), reason }, 'No active job to interrupt');
    return { interrupted: false, reason };
  }

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4), jobId, reason }, 'Interrupting user job');

  // 1. Kill CLI process if running
  if (running?.pid) {
    killProcessTree(running.pid);
    logger.info({ jobId, pid: running.pid }, 'Killed CLI process');
  }

  // 2. Cancel BullMQ job
  await cancelJob(jobId);

  // 3. Update database status
  try {
    await prisma.async_jobs.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
        cancelled_at: new Date(),
        error_message: `Interrupted: ${reason}`,
      },
    });
  } catch (error) {
    logger.warn({ jobId, error }, 'Failed to update job status in database');
  }

  // 4. Cleanup tracking
  runningJobs.delete(key);
  clearUpdateTracking(tenantId, senderPhone);

  return { interrupted: true, jobId, reason };
}

/**
 * Interrupt all running jobs (for graceful shutdown)
 */
export async function interruptAllJobs(reason: InterruptReason = 'shutdown'): Promise<number> {
  const prisma = getPrismaClient();
  let count = 0;

  for (const [key, job] of runningJobs.entries()) {
    const [tenantId, senderPhone] = key.split(':');

    // Kill process
    if (job.pid) {
      killProcessTree(job.pid);
    }

    // Update database
    try {
      await prisma.async_jobs.update({
        where: { id: job.jobId },
        data: {
          status: 'INTERRUPTED',
          error_message: `Interrupted: ${reason}`,
        },
      });
    } catch {
      // Job may not exist
    }

    logger.info({ tenantId, senderPhone: senderPhone?.slice(-4), jobId: job.jobId }, 'Interrupted job on shutdown');
    count++;
  }

  runningJobs.clear();
  return count;
}

/**
 * Get count of running jobs
 */
export function getRunningJobCount(): number {
  return runningJobs.size;
}

/**
 * JobInterruptService class for dependency injection
 */
export class JobInterruptService {
  registerRunningJob(tenantId: string, senderPhone: string, jobId: string, pid?: number): void {
    registerRunningJob(tenantId, senderPhone, jobId, pid);
  }

  updateJobPid(tenantId: string, senderPhone: string, pid: number): void {
    updateJobPid(tenantId, senderPhone, pid);
  }

  unregisterJob(tenantId: string, senderPhone: string): void {
    unregisterJob(tenantId, senderPhone);
  }

  getRunningJob(tenantId: string, senderPhone: string): { jobId: string; pid?: number } | null {
    return getRunningJob(tenantId, senderPhone);
  }

  async hasActiveJob(tenantId: string, senderPhone: string): Promise<boolean> {
    return hasActiveJob(tenantId, senderPhone);
  }

  async interruptUserJob(tenantId: string, senderPhone: string, reason: InterruptReason): Promise<InterruptResult> {
    return interruptUserJob(tenantId, senderPhone, reason);
  }

  async interruptAllJobs(reason?: InterruptReason): Promise<number> {
    return interruptAllJobs(reason);
  }
}
