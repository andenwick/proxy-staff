import { listSchedulesTool } from '../../tools/listSchedules.js';
import { cancelScheduleTool } from '../../tools/cancelSchedule.js';
import { scheduleTaskTool } from '../../tools/scheduleTask.js';
import { SchedulerService } from '../schedulerService.js';
import { MessageProcessor } from '../messageProcessor.js';
import { WhatsAppService } from '../whatsapp.js';
import { MessagingServiceResolver } from '../messaging/resolver.js';
import { ToolContext } from '../../tools/types.js';
import { PrismaClient } from '@prisma/client';

/**
 * Gap-filling tests for conversational task scheduling feature.
 * These tests cover critical user workflows that were not covered
 * by the Task Group 1-5 tests.
 */

// Mock Prisma client with snake_case table names
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
  $queryRaw: jest.fn(),
  scheduled_tasks: mockScheduledTasks,
  messages: {
    create: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(async (callback) => {
    return callback(mockPrisma);
  }),
};

// Mock session functions
jest.mock('../session.js', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: 'mock-session-id', isNew: false }),
  releaseSessionLease: jest.fn().mockResolvedValue(undefined),
}));

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

// Mock dependencies for scheduler
const mockMessageProcessor = {
  executeScheduledTask: jest.fn(),
};

// WhatsApp service (passed to constructor but messaging goes through resolver)
const mockWhatsAppService = {
  sendTextMessage: jest.fn(),
};

// Create a reusable mock messaging service that the resolver returns
// This abstracts both WhatsApp and Telegram (multi-platform support)
const mockMessagingService = {
  sendTextMessage: jest.fn().mockResolvedValue('msg-id'),
};

const mockMessagingResolver = {
  resolveForTenant: jest.fn().mockResolvedValue(mockMessagingService),
  getRecipientId: jest.fn().mockResolvedValue('+1234567890'),
};

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({
    stop: jest.fn(),
  }),
}));

describe('Scheduling Gap Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list_schedules with empty list', () => {
    it('returns "No scheduled tasks" message when user has no tasks', async () => {
      const context = createMockContext();

      mockScheduledTasks.findMany.mockResolvedValue([]);

      const result = await listSchedulesTool.execute({}, context);

      expect(result).toContain('No scheduled tasks');
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

  describe('schedule_task one-time validation', () => {
    it('rejects one-time task scheduled less than 1 minute in the future', async () => {
      const context = createMockContext();

      mockScheduledTasks.count.mockResolvedValue(0);

      // "in 30 seconds" is less than the 1 minute minimum
      const result = await scheduleTaskTool.execute(
        {
          task: 'Quick reminder',
          schedule: 'in 30 seconds',
        },
        context
      );

      expect(result.toLowerCase()).toContain('1 minute');
      expect(mockScheduledTasks.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel_schedule task not found', () => {
    it('returns not found message when task ID does not exist', async () => {
      const context = createMockContext();

      mockScheduledTasks.findUnique.mockResolvedValue(null);

      const result = await cancelScheduleTool.execute(
        { task_id: 'nonexistent-task-id' },
        context
      );

      expect(result.toLowerCase()).toContain('not found');
    });
  });

  describe('recurring task end-to-end flow', () => {
    it('updates next_run_at correctly for recurring task after execution', async () => {
      const schedulerService = new SchedulerService(
        mockPrisma as unknown as PrismaClient,
        mockMessageProcessor as unknown as MessageProcessor,
        mockWhatsAppService as unknown as WhatsAppService,
        mockMessagingResolver as unknown as MessagingServiceResolver
      );
      (schedulerService as any).acquireSchedulerLock = jest.fn().mockResolvedValue({
        query: jest.fn(),
        end: jest.fn(),
      });
      (schedulerService as any).releaseSchedulerLock = jest.fn().mockResolvedValue(undefined);

      const recurringTask = {
        id: 'recurring-task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Daily email check',
        task_type: 'reminder',
        is_one_time: false,
        cron_expr: '0 9 * * *', // Every day at 9am
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000), // Due 1 minute ago
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([recurringTask]);
      mockMessageProcessor.executeScheduledTask.mockResolvedValue('Email check complete');
      mockWhatsAppService.sendTextMessage.mockResolvedValue('msg-id');
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.update.mockResolvedValue({
        ...recurringTask,
        next_run_at: new Date(),
        last_run_at: new Date(),
      });

      await (schedulerService as any).processDueTasks();

      // Verify update was called with next_run_at in the future
      expect(mockScheduledTasks.update).toHaveBeenCalledWith({
        where: { id: 'recurring-task-123' },
        data: expect.objectContaining({
          last_run_at: expect.any(Date),
          next_run_at: expect.any(Date),
          error_count: 0,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });

      // Verify the next_run_at passed to update is in the future
      const updateCall = mockScheduledTasks.update.mock.calls[0][0];
      const nextRunAt = updateCall.data.next_run_at;
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('cancel_schedule requires input', () => {
    it('returns error when neither task_id nor task_description provided', async () => {
      const context = createMockContext();

      const result = await cancelScheduleTool.execute({}, context);

      expect(result.toLowerCase()).toContain('error');
      expect(result.toLowerCase()).toContain('provide');
    });
  });
});
