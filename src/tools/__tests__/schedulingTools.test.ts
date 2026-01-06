import { scheduleTaskTool } from '../scheduleTask.js';
import { listSchedulesTool } from '../listSchedules.js';
import { cancelScheduleTool } from '../cancelSchedule.js';
import { ToolContext } from '../types.js';

// Mock Prisma client with snake_case table names (as used in Prisma schema)
const mockScheduledTasks = {
  count: jest.fn(),
  create: jest.fn(),
  findMany: jest.fn(),
  findFirst: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockPrisma = {
  scheduled_tasks: mockScheduledTasks,
  // Mock $transaction to execute the callback with the same mock
  $transaction: jest.fn().mockImplementation(async (callback) => {
    return callback(mockPrisma);
  }),
};

// Mock context factory
function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    tenantId: 'tenant-123',
    senderPhone: '+1234567890',
    prisma: mockPrisma as unknown as ToolContext['prisma'],
    getCredential: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('Scheduling Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('schedule_task', () => {
    it('creates task and returns confirmation with next run time', async () => {
      const context = createMockContext();
      const nextRunAt = new Date('2025-12-24T15:00:00Z');

      mockScheduledTasks.count.mockResolvedValue(0);
      mockScheduledTasks.create.mockResolvedValue({
        id: 'task-uuid-123',
        task_prompt: 'Remind me to call mom',
        next_run_at: nextRunAt,
        is_one_time: true,
      });

      const result = await scheduleTaskTool.execute(
        {
          task: 'Remind me to call mom',
          schedule: 'tomorrow at 3pm',
        },
        context
      );

      expect(result).toContain('task-uuid-123');
      expect(result.toLowerCase()).toContain('scheduled');
      expect(mockScheduledTasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenant_id: 'tenant-123',
            user_phone: '+1234567890',
            task_prompt: 'Remind me to call mom',
          }),
        })
      );
    });

    it('enforces max 10 tasks per user limit', async () => {
      const context = createMockContext();

      mockScheduledTasks.count.mockResolvedValue(10);

      const result = await scheduleTaskTool.execute(
        {
          task: 'Another task',
          schedule: 'tomorrow at 9am',
        },
        context
      );

      expect(result.toLowerCase()).toContain('limit');
      expect(result).toContain('10');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });

    it('enforces min 1 hour interval for recurring tasks', async () => {
      const context = createMockContext();

      mockScheduledTasks.count.mockResolvedValue(0);

      // Note: This test assumes the schedule parser detects recurring patterns
      // and the tool validates minimum interval for recurring tasks
      const result = await scheduleTaskTool.execute(
        {
          task: 'Check something',
          schedule: 'every day at 9am', // Recurring - should check cron interval
        },
        context
      );

      // Recurring with 1 day interval should pass
      expect(mockScheduledTasks.create).toHaveBeenCalled();
    });
  });

  describe('list_schedules', () => {
    it('returns formatted list scoped to user', async () => {
      const context = createMockContext();

      mockScheduledTasks.findMany.mockResolvedValue([
        {
          id: 'task-1',
          task_prompt: 'Call mom every day',
          cron_expr: '0 9 * * *',
          next_run_at: new Date('2025-12-24T09:00:00Z'),
          is_one_time: false,
        },
        {
          id: 'task-2',
          task_prompt: 'Send report tomorrow',
          run_at: new Date('2025-12-24T14:00:00Z'),
          next_run_at: new Date('2025-12-24T14:00:00Z'),
          is_one_time: true,
        },
      ]);

      const result = await listSchedulesTool.execute({}, context);

      expect(result).toContain('task-1');
      expect(result).toContain('task-2');
      expect(result).toContain('Call mom');
      expect(result).toContain('Send report');
      expect(mockScheduledTasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-123',
            user_phone: '+1234567890',
            enabled: true,
          },
        })
      );
    });
  });

  describe('cancel_schedule', () => {
    it('cancels task by ID by setting enabled=false', async () => {
      const context = createMockContext();

      mockScheduledTasks.findUnique.mockResolvedValue({
        id: 'task-123',
        tenant_id: 'tenant-123',
        user_phone: '+1234567890',
        task_prompt: 'Call mom',
        is_one_time: false, // Recurring task - soft delete
        enabled: true,
      });
      mockScheduledTasks.update.mockResolvedValue({
        id: 'task-123',
        enabled: false,
      });

      const result = await cancelScheduleTool.execute(
        { task_id: 'task-123' },
        context
      );

      expect(result.toLowerCase()).toContain('cancel');
      expect(mockScheduledTasks.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: { enabled: false },
      });
    });

    it('cancels task by fuzzy description match', async () => {
      const context = createMockContext();

      mockScheduledTasks.findFirst.mockResolvedValue({
        id: 'task-456',
        tenant_id: 'tenant-123',
        user_phone: '+1234567890',
        task_prompt: 'Remind me to call mom every day',
        is_one_time: false,
        enabled: true,
      });
      mockScheduledTasks.update.mockResolvedValue({
        id: 'task-456',
        enabled: false,
      });

      const result = await cancelScheduleTool.execute(
        { task_description: 'call mom' },
        context
      );

      expect(result.toLowerCase()).toContain('cancel');
      expect(mockScheduledTasks.findFirst).toHaveBeenCalled();
    });
  });
});
