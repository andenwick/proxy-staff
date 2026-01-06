import { getConfig } from '../../config/index.js';
import { getPrismaClient } from '../prisma.js';
import { logger } from '../../utils/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  currentCount?: number;
  maxAllowed?: number;
}

/**
 * Check if a tenant can queue a new job
 * Limits the number of PENDING + RUNNING jobs per tenant
 */
export async function canQueue(tenantId: string): Promise<RateLimitResult> {
  const config = getConfig();
  const prisma = getPrismaClient();
  const maxQueuedJobs = config.queue.maxQueuedJobsPerTenant;

  try {
    const queuedCount = await prisma.async_jobs.count({
      where: {
        tenant_id: tenantId,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });

    if (queuedCount >= maxQueuedJobs) {
      logger.warn(
        { tenantId, queuedCount, maxQueuedJobs },
        'Tenant rate limit reached'
      );
      return {
        allowed: false,
        reason: 'Too many pending requests. Please wait for current ones to complete.',
        currentCount: queuedCount,
        maxAllowed: maxQueuedJobs,
      };
    }

    return {
      allowed: true,
      currentCount: queuedCount,
      maxAllowed: maxQueuedJobs,
    };
  } catch (error) {
    logger.error({ tenantId, error }, 'Failed to check tenant rate limit');
    // On error, allow the request (fail open)
    return { allowed: true };
  }
}

/**
 * Get current queue count for a tenant
 */
export async function getQueuedCount(tenantId: string): Promise<number> {
  const prisma = getPrismaClient();

  return prisma.async_jobs.count({
    where: {
      tenant_id: tenantId,
      status: { in: ['PENDING', 'RUNNING'] },
    },
  });
}

/**
 * TenantRateLimiter class for dependency injection
 */
export class TenantRateLimiter {
  async canQueue(tenantId: string): Promise<RateLimitResult> {
    return canQueue(tenantId);
  }

  async getQueuedCount(tenantId: string): Promise<number> {
    return getQueuedCount(tenantId);
  }
}
