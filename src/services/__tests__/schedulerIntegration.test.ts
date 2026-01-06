import { SchedulerService } from '../schedulerService.js';
import { MessageProcessor } from '../messageProcessor.js';
import { WhatsAppService } from '../whatsapp.js';
import { MessagingServiceResolver } from '../messaging/resolver.js';
import { PrismaClient } from '@prisma/client';

// Mock dependencies with snake_case table names
const mockScheduledTasks = {
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const mockPrisma = {
  $queryRaw: jest.fn(),
  scheduled_tasks: mockScheduledTasks,
  messages: {
    create: jest.fn(),
  },
};

// Mock session functions
jest.mock('../session.js', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: 'mock-session-id', isNew: false }),
  releaseSessionLease: jest.fn().mockResolvedValue(undefined),
}));

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

// Mock node-cron - must use factory function that returns a new object
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({
    stop: jest.fn(),
  }),
}));

import * as cron from 'node-cron';

describe('Scheduler Integration', () => {
  let schedulerService: SchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    schedulerService = new SchedulerService(
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
  });

  describe('Service lifecycle', () => {
    it('scheduler starts when services initialized', () => {
      // Simulate what happens in initializeServices()
      schedulerService.start();

      // Verify cron job is scheduled to run every minute
      expect(cron.schedule).toHaveBeenCalledWith(
        '* * * * *',
        expect.any(Function)
      );
    });

    it('scheduler stops on graceful shutdown', () => {
      // Start the scheduler
      schedulerService.start();

      // Get the mock cron job that was created
      const mockScheduledTask = (cron.schedule as jest.Mock).mock.results[0].value;

      // Simulate graceful shutdown
      schedulerService.stop();

      // Verify cron job stop was called
      expect(mockScheduledTask.stop).toHaveBeenCalled();
    });
  });

  describe('End-to-end flow', () => {
    it('schedule_task -> scheduler executes -> WhatsApp message sent', async () => {
      // Simulate a scheduled task created by schedule_task tool
      const scheduledTask = {
        id: 'task-e2e-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Remind me to check my emails',
        task_type: 'reminder',
        is_one_time: true,
        cron_expr: null,
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000), // Due 1 minute ago
        enabled: true,
      };

      // Setup mocks for the execution flow
      mockPrisma.$queryRaw.mockResolvedValue([scheduledTask]);
      mockMessageProcessor.executeScheduledTask.mockResolvedValue('Time to check your emails!');
      mockWhatsAppService.sendTextMessage.mockResolvedValue('whatsapp-msg-id-789');
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.delete.mockResolvedValue(scheduledTask);

      // Execute the scheduler's task processing (simulates cron tick)
      await (schedulerService as any).processDueTasks();

      // Verify: Task was claimed
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();

      // Verify: MessageProcessor executed the task (5 args: tenantId, phone, prompt, type, previousOutputs)
      expect(mockMessageProcessor.executeScheduledTask).toHaveBeenCalledWith(
        'tenant-456',
        '+1234567890',
        'Remind me to check my emails',
        'reminder',
        [] // previousOutputs (empty for new task)
      );

      // Verify: Message was sent via messaging resolver (WhatsApp or Telegram)
      expect(mockMessagingService.sendTextMessage).toHaveBeenCalledWith(
        '+1234567890',
        'Time to check your emails!'
      );

      // Verify: One-time task was deleted after successful execution
      expect(mockScheduledTasks.delete).toHaveBeenCalledWith({
        where: { id: 'task-e2e-123' },
      });
    });
  });
});
