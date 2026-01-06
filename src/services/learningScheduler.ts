import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { LearningService } from './learningService.js';
import { logger } from '../utils/logger.js';

// Minimum hours between periodic learning for the same tenant
const MIN_HOURS_BETWEEN_LEARNING = 12;

/**
 * LearningScheduler triggers periodic learning reviews for all active tenants.
 *
 * Runs on a schedule (every 8 hours) and ensures each tenant gets at most
 * one periodic learning review per 12 hours to avoid excessive processing.
 */
export class LearningScheduler {
  private learningJob: cron.ScheduledTask | null = null;
  private lastLearningTime: Map<string, Date> = new Map();

  constructor(
    private prisma: PrismaClient,
    private learningService: LearningService
  ) {}

  /**
   * Start the scheduler
   */
  start(): void {
    // Run periodic learning every 8 hours (at 0:00, 8:00, 16:00)
    this.learningJob = cron.schedule('0 */8 * * *', async () => {
      logger.info('Starting scheduled periodic learning cycle');
      await this.runForAllTenants();
    });

    logger.info('Learning scheduler started (runs every 8 hours)');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.learningJob?.stop();
    logger.info('Learning scheduler stopped');
  }

  /**
   * Run periodic learning for all active tenants (with rate limiting)
   */
  private async runForAllTenants(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    logger.info({ tenantCount: tenants.length }, 'Running periodic learning for tenants');

    let processed = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      // Rate limit check
      if (this.shouldSkipTenant(tenant.id)) {
        skipped++;
        continue;
      }

      try {
        await this.runForTenant(tenant.id);
        processed++;
      } catch (error) {
        logger.error({ tenantId: tenant.id, error }, 'Periodic learning failed for tenant');
      }
    }

    logger.info(
      { processed, skipped, total: tenants.length },
      'Periodic learning cycle completed'
    );
  }

  /**
   * Check if a tenant should be skipped due to rate limiting
   */
  private shouldSkipTenant(tenantId: string): boolean {
    const lastTime = this.lastLearningTime.get(tenantId);
    if (!lastTime) return false;

    const hoursSinceLast = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
    return hoursSinceLast < MIN_HOURS_BETWEEN_LEARNING;
  }

  /**
   * Run periodic learning for a specific tenant
   */
  private async runForTenant(tenantId: string): Promise<void> {
    logger.info({ tenantId }, 'Starting periodic learning for tenant');

    try {
      // Trigger the periodic learning review
      await this.learningService.triggerPeriodicLearning(tenantId);

      // Update last learning time
      this.lastLearningTime.set(tenantId, new Date());

      // Reset the periodic session to clear context for next time
      await this.learningService.resetPeriodicSession(tenantId);

      logger.info({ tenantId }, 'Periodic learning completed for tenant');
    } catch (error) {
      logger.error({ tenantId, error }, 'Periodic learning failed');
      throw error;
    }
  }

  /**
   * Manually trigger periodic learning for a tenant (bypasses rate limit)
   */
  async triggerForTenant(tenantId: string): Promise<void> {
    logger.info({ tenantId }, 'Manually triggering periodic learning');
    await this.runForTenant(tenantId);
  }

  /**
   * Get the last learning time for a tenant
   */
  getLastLearningTime(tenantId: string): Date | undefined {
    return this.lastLearningTime.get(tenantId);
  }
}
