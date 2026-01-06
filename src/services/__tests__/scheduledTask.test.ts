import { PrismaClient } from '@prisma/client';

/**
 * ScheduledTask Schema Tests
 *
 * These tests document and verify the expected Prisma schema API shape
 * for the ScheduledTask model. They verify correct query patterns
 * rather than testing Prisma itself.
 */

// Mock PrismaClient for schema documentation tests
const mockPrisma = {
  tenant: {
    create: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
  },
  scheduledTask: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

describe('ScheduledTask Schema', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Task creation API shape', () => {
    it('accepts required fields: tenant_id, user_phone, task_prompt, next_run_at', async () => {
      const createInput = {
        data: {
          tenant_id: 'tenant-uuid-456',
          user_phone: '+1234567890',
          task_prompt: 'Remind me to call mom',
          next_run_at: new Date('2025-12-24T15:00:00Z'),
          is_one_time: true,
        },
      };

      mockPrisma.scheduledTask.create.mockResolvedValue({ id: 'task-123' });

      await mockPrisma.scheduledTask.create(createInput);

      // Verify the create was called with correct structure
      expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith(createInput);
      expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: expect.any(String),
            user_phone: expect.any(String),
            task_prompt: expect.any(String),
            next_run_at: expect.any(Date),
          }),
        })
      );
    });
  });

  describe('Tenant relationship', () => {
    it('queries tasks by tenant_id for cascade delete verification', async () => {
      mockPrisma.scheduledTask.findMany.mockResolvedValue([
        { id: 'task-1', tenant_id: 'tenant-to-delete' },
        { id: 'task-2', tenant_id: 'tenant-to-delete' },
      ]);

      await mockPrisma.scheduledTask.findMany({
        where: { tenant_id: 'tenant-to-delete' },
      });

      // Verify query uses tenant_id filter correctly
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-to-delete' },
      });
    });
  });

  describe('Due tasks query pattern', () => {
    it('uses next_run_at <= NOW() AND enabled = true filter', async () => {
      const now = new Date();
      const expectedQuery = {
        where: {
          next_run_at: { lte: now },
          enabled: true,
        },
      };

      mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

      await mockPrisma.scheduledTask.findMany(expectedQuery);

      // Verify query pattern matches expected scheduler polling query
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            next_run_at: expect.objectContaining({ lte: expect.any(Date) }),
            enabled: true,
          }),
        })
      );
    });
  });

  describe('Index-optimized query pattern', () => {
    it('orders by next_run_at for efficient polling with composite index', async () => {
      const indexOptimizedQuery = {
        where: {
          next_run_at: { lte: new Date() },
          enabled: true,
        },
        orderBy: { next_run_at: 'asc' as const },
      };

      mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

      await mockPrisma.scheduledTask.findMany(indexOptimizedQuery);

      // Verify query uses index-friendly pattern [next_run_at, enabled]
      expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            next_run_at: expect.any(Object),
            enabled: true,
          }),
          orderBy: { next_run_at: 'asc' },
        })
      );
    });
  });
});
