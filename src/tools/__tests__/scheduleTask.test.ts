/**
 * Tests for schedule_task tool
 *
 * These tests verify:
 * 1. Basic task scheduling works (reminder and execute types)
 * 2. Schedule parsing validation
 * 3. Task limit enforcement
 */

import { ToolContext } from '../types.js';

// Mock cron-parser - returns dates 5 minutes apart for recurring interval validation
const mockFirstRun = new Date(Date.now() + 120000); // 2 minutes from now
const mockSecondRun = new Date(mockFirstRun.getTime() + 5 * 60 * 1000); // 5 minutes after first

jest.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: jest.fn().mockReturnValue({
      next: jest.fn()
        .mockReturnValueOnce({ toDate: () => mockSecondRun }) // Second call for interval check
        .mockReturnValue({ toDate: () => mockSecondRun }),
    }),
  },
}));

// Mock scheduleParser
jest.mock('../../services/scheduleParser.js', () => ({
  parseSchedule: jest.fn().mockImplementation((schedule: string) => {
    if (schedule === 'invalid schedule') {
      return null;
    }
    if (schedule.includes('every')) {
      return {
        isRecurring: true,
        cronExpr: '*/5 * * * *',
        timezone: 'America/Denver',
      };
    }
    return {
      isRecurring: false,
      runAt: new Date(Date.now() + 120000),
      timezone: 'America/Denver',
    };
  }),
  calculateNextRun: jest.fn().mockReturnValue(mockFirstRun),
}));

// Mock prisma with $transaction support
const mockScheduledTasks = {
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    return Promise.resolve({
      id: 'task-123',
      ...args.data,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }),
};

const mockPrisma = {
  scheduled_tasks: mockScheduledTasks,
  $transaction: jest.fn().mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    // Provide a transaction object with the same interface
    const tx = {
      scheduled_tasks: mockScheduledTasks,
    };
    return callback(tx);
  }),
};

// Import after mocks are set up
import { scheduleTaskTool } from '../scheduleTask.js';

// Create mock context
const createMockContext = (): ToolContext => ({
  tenantId: 'tenant-456',
  senderPhone: '+1234567890',
  prisma: mockPrisma as unknown as ToolContext['prisma'],
  getCredential: jest.fn().mockResolvedValue(null),
});

describe('schedule_task tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduledTasks.count.mockResolvedValue(0);
  });

  describe('basic scheduling', () => {
    it('schedules a reminder task', async () => {
      const input = {
        task: 'Remind me to call mom',
        schedule: 'tomorrow at 3pm',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('scheduled successfully');
      expect(mockScheduledTasks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_prompt: 'Remind me to call mom',
          task_type: 'reminder',
        }),
      });
    });

    it('schedules an execute task', async () => {
      const input = {
        task: 'Check my emails and summarize',
        schedule: 'tomorrow at 3pm',
        task_type: 'execute',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('scheduled successfully');
      expect(mockScheduledTasks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_prompt: 'Check my emails and summarize',
          task_type: 'execute',
        }),
      });
    });

    it('schedules a recurring task', async () => {
      const input = {
        task: 'Daily email summary',
        schedule: 'every day at 9am',
        task_type: 'execute',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('Recurring task scheduled successfully');
      expect(mockScheduledTasks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          task_prompt: 'Daily email summary',
          is_one_time: false,
          cron_expr: '*/5 * * * *',
        }),
      });
    });
  });

  describe('validation', () => {
    it('rejects empty task', async () => {
      const input = {
        task: '',
        schedule: 'tomorrow at 3pm',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('Error');
      expect(result).toContain('Task description is required');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });

    it('rejects empty schedule', async () => {
      const input = {
        task: 'Do something',
        schedule: '',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('Error');
      expect(result).toContain('Schedule is required');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });

    it('rejects invalid schedule format', async () => {
      const input = {
        task: 'Do something',
        schedule: 'invalid schedule',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('could not understand that schedule');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });
  });

  describe('task limits', () => {
    it('rejects when user has max tasks', async () => {
      mockScheduledTasks.count.mockResolvedValue(10);

      const input = {
        task: 'Another task',
        schedule: 'tomorrow at 3pm',
      };

      const context = createMockContext();
      const result = await scheduleTaskTool.execute(input, context);

      expect(result).toContain('Error');
      expect(result).toContain('maximum limit');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });
  });
});
