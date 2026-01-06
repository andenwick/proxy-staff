import * as cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { SelfImprovementService } from './selfImprovement.js';
import { logger } from '../utils/logger.js';

export class ImprovementScheduler {
  private improvementJob: cron.ScheduledTask | null = null;
  private verificationJob: cron.ScheduledTask | null = null;

  constructor(
    private prisma: PrismaClient,
    private selfImprovement: SelfImprovementService
  ) {}

  /**
   * Start the scheduler
   */
  start(): void {
    // Run improvement cycle every 6 hours
    this.improvementJob = cron.schedule('0 */6 * * *', async () => {
      logger.info('Starting scheduled improvement cycle');
      await this.runForAllTenants();
    });

    // Run verification checks every hour
    this.verificationJob = cron.schedule('30 * * * *', async () => {
      logger.info('Starting scheduled verification cycle');
      await this.verifyPendingImprovements();
    });

    logger.info('Improvement scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    this.improvementJob?.stop();
    this.verificationJob?.stop();
    logger.info('Improvement scheduler stopped');
  }

  /**
   * Run improvement cycle for all active tenants
   */
  private async runForAllTenants(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });

    logger.info({ tenantCount: tenants.length }, 'Running improvement cycle for tenants');

    for (const tenant of tenants) {
      try {
        const result = await this.selfImprovement.runImprovementCycle(tenant.id);
        if (result.improved) {
          logger.info({ tenantId: tenant.id, improvementId: result.improvementId }, 'Tenant improved');
        }
      } catch (error) {
        logger.error({ tenantId: tenant.id, error }, 'Improvement cycle failed for tenant');
      }
    }
  }

  /**
   * Verify pending improvements older than 4 hours
   */
  private async verifyPendingImprovements(): Promise<void> {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);

    const pendingImprovements = await this.prisma.improvement_logs.findMany({
      where: {
        verification_status: 'pending',
        created_at: { lt: cutoff },
      },
      select: { id: true, tenant_id: true },
    });

    logger.info({ count: pendingImprovements.length }, 'Verifying pending improvements');

    for (const improvement of pendingImprovements) {
      try {
        const status = await this.selfImprovement.verifyImprovement(improvement.id);
        logger.info({ improvementId: improvement.id, status }, 'Improvement verified');
      } catch (error) {
        logger.error({ improvementId: improvement.id, error }, 'Verification failed');
      }
    }
  }

  /**
   * Manually trigger improvement cycle for a tenant
   */
  async triggerForTenant(tenantId: string): Promise<{ improved: boolean; improvementId?: string }> {
    return this.selfImprovement.runImprovementCycle(tenantId);
  }
}
