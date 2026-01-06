import { Queue, Job } from 'bullmq';
import Redis from 'ioredis';
import crypto from 'crypto';
import { getConfig } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { getPrismaClient } from '../prisma.js';

/**
 * Job data for long-running CLI tasks
 */
export interface LongTaskJob {
  type: 'cli-task';
  jobId: string;       // DB async_jobs.id
  tenantId: string;
  senderPhone: string;
  sessionId: string;
  message: string;
  estimatedDurationMs: number;
}

/**
 * Job data for session-end learning triggers
 */
export interface SessionEndJob {
  type: 'session-end';
  sessionId: string;
  tenantId: string;
  senderPhone: string;
  reason: 'reset' | 'expiry' | 'manual';
}

/**
 * Union type for all queue jobs
 */
export type QueueJob = LongTaskJob | SessionEndJob;

// Dedup cache: hash -> timestamp
const recentJobHashes = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000; // 5 seconds

// Distributed lock TTL
const LOCK_TTL_SECONDS = 10;

let redisConnection: Redis | null = null;
let queue: Queue<QueueJob> | null = null;

/**
 * Get or create Redis connection
 */
export function getRedisConnection(): Redis {
  if (!redisConnection) {
    const config = getConfig();
    redisConnection = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });

    redisConnection.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    redisConnection.on('connect', () => {
      logger.info('Redis connected');
    });

    redisConnection.on('reconnecting', () => {
      logger.warn('Redis reconnecting...');
    });
  }
  return redisConnection;
}

/**
 * Get or create BullMQ queue
 */
export function getQueue(): Queue<QueueJob> {
  if (!queue) {
    const connection = getRedisConnection();
    queue = new Queue<QueueJob>('async-tasks', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 minute initial delay
        },
        removeOnComplete: {
          age: 86400, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // 7 days
          count: 5000,
        },
      },
    });
  }
  return queue;
}

/**
 * Generate dedup hash for a job
 * Hash: sha256(tenantId | senderPhone | message.trim().toLowerCase())
 */
export function generateDedupHash(tenantId: string, senderPhone: string, message: string): string {
  const normalized = `${tenantId}|${senderPhone}|${message.trim().toLowerCase()}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Check if a job is a duplicate within the dedup window
 */
export function isDuplicate(dedupHash: string): boolean {
  const now = Date.now();
  const timestamp = recentJobHashes.get(dedupHash);

  if (timestamp && (now - timestamp) < DEDUP_WINDOW_MS) {
    return true;
  }

  return false;
}

/**
 * Record a job hash for dedup checking
 */
export function recordJobHash(dedupHash: string): void {
  recentJobHashes.set(dedupHash, Date.now());
}

/**
 * Cleanup expired dedup hashes (call periodically)
 */
export function cleanupDedupHashes(): void {
  const now = Date.now();
  for (const [hash, timestamp] of recentJobHashes.entries()) {
    if ((now - timestamp) >= DEDUP_WINDOW_MS) {
      recentJobHashes.delete(hash);
    }
  }
}

// Cleanup interval (every 30 seconds)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start dedup cleanup interval
 */
export function startDedupCleanup(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupDedupHashes, 30000);
  }
}

/**
 * Stop dedup cleanup interval
 */
export function stopDedupCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Acquire a distributed lock for a user's job operations
 * Prevents race conditions when two messages arrive simultaneously
 */
export async function acquireLock(tenantId: string, senderPhone: string): Promise<boolean> {
  const redis = getRedisConnection();
  const lockKey = `job:lock:${tenantId}:${senderPhone}`;
  const lockValue = `${process.pid}:${Date.now()}`;

  // SET NX EX - set if not exists with expiry
  const result = await redis.set(lockKey, lockValue, 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

/**
 * Release a distributed lock
 */
export async function releaseLock(tenantId: string, senderPhone: string): Promise<void> {
  const redis = getRedisConnection();
  const lockKey = `job:lock:${tenantId}:${senderPhone}`;
  await redis.del(lockKey);
}

/**
 * Add a CLI task job to the queue
 * Returns the BullMQ job ID
 */
export async function addJob(job: Omit<LongTaskJob, 'type'>): Promise<string> {
  const q = getQueue();
  const prisma = getPrismaClient();

  // Check dedup
  const dedupHash = generateDedupHash(job.tenantId, job.senderPhone, job.message);
  if (isDuplicate(dedupHash)) {
    throw new Error('Already processing that request');
  }

  // Record hash for future dedup checks
  recordJobHash(dedupHash);

  // Create database record
  await prisma.async_jobs.create({
    data: {
      id: job.jobId,
      tenant_id: job.tenantId,
      sender_phone: job.senderPhone,
      session_id: job.sessionId,
      input_message: job.message,
      estimated_ms: job.estimatedDurationMs,
      dedup_hash: dedupHash,
      status: 'PENDING',
    },
  });

  // Add to BullMQ queue with type
  const jobWithType: LongTaskJob = { ...job, type: 'cli-task' };
  const bullJob = await q.add('cli-task', jobWithType, {
    jobId: job.jobId, // Use DB ID as BullMQ job ID
  });

  logger.info({ jobId: job.jobId, tenantId: job.tenantId }, 'Job added to queue');

  return bullJob.id || job.jobId;
}

/**
 * Add a session-end learning job to the queue
 */
export async function addSessionEndJob(
  sessionId: string,
  tenantId: string,
  senderPhone: string,
  reason: 'reset' | 'expiry' | 'manual' = 'expiry'
): Promise<void> {
  const q = getQueue();
  const jobId = `session-end-${sessionId}-${Date.now()}`;

  const job: SessionEndJob = {
    type: 'session-end',
    sessionId,
    tenantId,
    senderPhone,
    reason,
  };

  await q.add('session-end', job, {
    jobId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600 }, // 1 hour
    removeOnFail: { age: 86400 }, // 1 day
  });

  logger.info({ sessionId, tenantId, reason }, 'Session end job queued');
}

/**
 * Cancel a job by ID
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const q = getQueue();
  const prisma = getPrismaClient();

  try {
    // Try to remove from BullMQ queue (if still waiting)
    const job = await q.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'waiting' || state === 'delayed') {
        await job.remove();
      }
    }

    // Update database
    await prisma.async_jobs.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
        cancelled_at: new Date(),
      },
    });

    logger.info({ jobId }, 'Job cancelled');
    return true;
  } catch (error) {
    logger.warn({ jobId, error }, 'Failed to cancel job');
    return false;
  }
}

/**
 * Get active job for a user (PENDING or RUNNING)
 */
export async function getActiveJobForUser(
  tenantId: string,
  senderPhone: string
): Promise<{ id: string; status: string } | null> {
  const prisma = getPrismaClient();

  const job = await prisma.async_jobs.findFirst({
    where: {
      tenant_id: tenantId,
      sender_phone: senderPhone,
      status: { in: ['PENDING', 'RUNNING'] },
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true },
  });

  return job;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<Job<QueueJob> | undefined> {
  const q = getQueue();
  return q.getJob(jobId);
}

/**
 * Check if Redis is healthy
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const result = await Promise.race([
      redis.ping(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Redis health check timeout')), 500)
      ),
    ]);
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const q = getQueue();
  const counts = await q.getJobCounts();
  return {
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: counts.completed || 0,
    failed: counts.failed || 0,
  };
}

/**
 * Graceful shutdown
 */
export async function shutdown(): Promise<void> {
  stopDedupCleanup();

  if (queue) {
    await queue.close();
    queue = null;
  }

  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  logger.info('QueueService shutdown complete');
}
