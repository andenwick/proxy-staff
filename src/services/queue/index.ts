/**
 * Async Task Queue - Export Barrel
 *
 * This module provides async task queue functionality for long-running CLI operations.
 */

// Queue Service - BullMQ queue management
export {
  LongTaskJob,
  SessionEndJob,
  QueueJob,
  getRedisConnection,
  getQueue,
  generateDedupHash,
  isDuplicate,
  recordJobHash,
  cleanupDedupHashes,
  startDedupCleanup,
  stopDedupCleanup,
  acquireLock,
  releaseLock,
  addJob,
  addSessionEndJob,
  cancelJob,
  getActiveJobForUser,
  getJob,
  isRedisHealthy,
  getQueueStats,
  shutdown as shutdownQueue,
} from './queueService.js';

// Queue Worker - Job processor
export {
  setSendMessageFn,
  startWorker,
  stopWorker,
  pauseWorker,
  resumeWorker,
  isWorkerRunning,
  getWorker,
} from './queueWorker.js';

// Job Interrupt Service - Cancel/interrupt handling
export {
  InterruptReason,
  InterruptResult,
  registerRunningJob,
  updateJobPid,
  unregisterJob,
  getRunningJob,
  hasActiveJob,
  interruptUserJob,
  interruptAllJobs,
  getRunningJobCount,
  JobInterruptService,
} from './jobInterruptService.js';

// Tenant Rate Limiter - Per-tenant rate limiting
export {
  RateLimitResult,
  canQueue,
  getQueuedCount,
  TenantRateLimiter,
} from './tenantRateLimiter.js';

// Progress Messenger - Progress updates
export {
  SendMessageFn,
  getProgressMessage,
  shouldSendUpdate,
  recordUpdateSent,
  clearUpdateTracking,
  sendProgressUpdate,
  ProgressMessenger,
} from './progressMessenger.js';
