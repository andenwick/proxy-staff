/**
 * ImprovementScheduler Tests
 */

import { ImprovementScheduler } from '../improvementScheduler.js';

// Mock node-cron
const mockSchedule = jest.fn().mockReturnValue({
  stop: jest.fn(),
});

jest.mock('node-cron', () => ({
  schedule: (...args: unknown[]) => mockSchedule(...args),
}));

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ImprovementScheduler', () => {
  let mockPrisma: any;
  let mockSelfImprovement: any;
  let scheduler: ImprovementScheduler;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      improvement_logs: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockSelfImprovement = {
      runImprovementCycle: jest.fn().mockResolvedValue({ improved: false }),
      verifyImprovement: jest.fn().mockResolvedValue('neutral'),
    };

    scheduler = new ImprovementScheduler(mockPrisma, mockSelfImprovement);
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe('start', () => {
    it('schedules improvement job every 6 hours', () => {
      scheduler.start();

      expect(mockSchedule).toHaveBeenCalledWith(
        '0 */6 * * *',
        expect.any(Function)
      );
    });

    it('schedules verification job every hour at :30', () => {
      scheduler.start();

      expect(mockSchedule).toHaveBeenCalledWith(
        '30 * * * *',
        expect.any(Function)
      );
    });
  });

  describe('stop', () => {
    it('stops scheduled jobs', () => {
      const mockJob = { stop: jest.fn() };
      mockSchedule.mockReturnValue(mockJob);

      scheduler.start();
      scheduler.stop();

      expect(mockJob.stop).toHaveBeenCalled();
    });
  });

  describe('improvement cycle (via cron callback)', () => {
    it('runs improvement cycle for all active tenants', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
      ]);

      // Get the cron callback
      scheduler.start();
      const improvementCallback = mockSchedule.mock.calls[0][1];

      await improvementCallback();

      expect(mockSelfImprovement.runImprovementCycle).toHaveBeenCalledWith('tenant-1');
      expect(mockSelfImprovement.runImprovementCycle).toHaveBeenCalledWith('tenant-2');
    });

    it('continues processing even if one tenant fails', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([
        { id: 'tenant-1' },
        { id: 'tenant-2' },
      ]);

      mockSelfImprovement.runImprovementCycle
        .mockRejectedValueOnce(new Error('Tenant 1 failed'))
        .mockResolvedValueOnce({ improved: true });

      scheduler.start();
      const improvementCallback = mockSchedule.mock.calls[0][1];

      await improvementCallback();

      expect(mockSelfImprovement.runImprovementCycle).toHaveBeenCalledTimes(2);
    });

    it('only processes active tenants', async () => {
      scheduler.start();
      const improvementCallback = mockSchedule.mock.calls[0][1];

      await improvementCallback();

      expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
        select: { id: true },
      });
    });
  });

  describe('verification cycle (via cron callback)', () => {
    it('verifies pending improvements older than 4 hours', async () => {
      mockPrisma.improvement_logs.findMany.mockResolvedValue([
        { id: 'imp-1', tenant_id: 'tenant-1' },
        { id: 'imp-2', tenant_id: 'tenant-2' },
      ]);

      scheduler.start();
      // Second schedule call is verification
      const verificationCallback = mockSchedule.mock.calls[1][1];

      await verificationCallback();

      expect(mockSelfImprovement.verifyImprovement).toHaveBeenCalledWith('imp-1');
      expect(mockSelfImprovement.verifyImprovement).toHaveBeenCalledWith('imp-2');
    });

    it('queries for pending improvements with correct cutoff', async () => {
      scheduler.start();
      const verificationCallback = mockSchedule.mock.calls[1][1];

      await verificationCallback();

      expect(mockPrisma.improvement_logs.findMany).toHaveBeenCalledWith({
        where: {
          verification_status: 'pending',
          created_at: { lt: expect.any(Date) },
        },
        select: { id: true, tenant_id: true },
      });
    });

    it('continues processing even if one verification fails', async () => {
      mockPrisma.improvement_logs.findMany.mockResolvedValue([
        { id: 'imp-1', tenant_id: 'tenant-1' },
        { id: 'imp-2', tenant_id: 'tenant-2' },
      ]);

      mockSelfImprovement.verifyImprovement
        .mockRejectedValueOnce(new Error('Verification failed'))
        .mockResolvedValueOnce('improved');

      scheduler.start();
      const verificationCallback = mockSchedule.mock.calls[1][1];

      await verificationCallback();

      expect(mockSelfImprovement.verifyImprovement).toHaveBeenCalledTimes(2);
    });
  });

  describe('triggerForTenant', () => {
    it('runs improvement cycle for specific tenant', async () => {
      mockSelfImprovement.runImprovementCycle.mockResolvedValue({
        improved: true,
        improvementId: 'imp-123',
      });

      const result = await scheduler.triggerForTenant('tenant-1');

      expect(result).toEqual({ improved: true, improvementId: 'imp-123' });
      expect(mockSelfImprovement.runImprovementCycle).toHaveBeenCalledWith('tenant-1');
    });
  });
});
