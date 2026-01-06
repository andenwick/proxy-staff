import { SchedulerService } from '../schedulerService.js';
import { MessageProcessor } from '../messageProcessor.js';
import { WhatsAppService } from '../whatsapp.js';
import { MessagingServiceResolver } from '../messaging/resolver.js';
import { PrismaClient } from '@prisma/client';

// Mock dependencies with snake_case table names
const mockScheduledTasks = {
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

// Mock node-cron
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({
    stop: jest.fn(),
  }),
}));

import * as cron from 'node-cron';

describe('SchedulerService', () => {
  let schedulerService: SchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock messaging service for each test
    mockMessagingService.sendTextMessage.mockResolvedValue('msg-id');

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

  describe('processDueTasks', () => {
    it('queries tasks where next_run_at <= NOW() AND enabled=true', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await (schedulerService as any).processDueTasks();

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('deletes one-time task after successful execution', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Remind me to call mom',
        task_type: 'reminder',
        is_one_time: true,
        cron_expr: null,
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000), // Due 1 minute ago
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockResolvedValue('Reminder: call mom');
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.delete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      expect(mockScheduledTasks.delete).toHaveBeenCalledWith({
        where: { id: 'task-123' },
      });
    });

    it('sends message via messaging resolver (supports WhatsApp and Telegram)', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Remind me to call mom',
        task_type: 'reminder',
        is_one_time: true,
        cron_expr: null,
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000),
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockResolvedValue('Reminder: call mom');
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.delete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      // Verify messaging goes through the resolver (multi-platform support)
      expect(mockMessagingResolver.resolveForTenant).toHaveBeenCalledWith('tenant-456');
      expect(mockMessagingResolver.getRecipientId).toHaveBeenCalledWith('tenant-456', '+1234567890');
      expect(mockMessagingService.sendTextMessage).toHaveBeenCalledWith('+1234567890', 'Reminder: call mom');
    });

    it('updates next_run_at for recurring task after execution', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Daily summary',
        task_type: 'reminder',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000),
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockResolvedValue('Here is your daily summary');
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.update.mockResolvedValue({ ...task, next_run_at: new Date() });

      await (schedulerService as any).processDueTasks();

      expect(mockScheduledTasks.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          last_run_at: expect.any(Date),
          next_run_at: expect.any(Date),
          error_count: 0,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });
    });

    it('increments error_count on task execution failure', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Daily summary',
        task_type: 'reminder',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000),
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockRejectedValue(new Error('API error'));
      mockScheduledTasks.update.mockResolvedValue({ ...task, error_count: 1 });

      await (schedulerService as any).processDueTasks();

      expect(mockScheduledTasks.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          error_count: 1,
          next_run_at: expect.any(Date),
          lease_owner: null,
          lease_expires_at: null,
        }),
      });
    });

    it('disables task after 3 consecutive failures and notifies user', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Daily summary',
        task_type: 'reminder',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        timezone: 'America/Denver',
        error_count: 2, // Will become 3 after this failure
        next_run_at: new Date(Date.now() - 60000),
        enabled: true,
      };

      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockRejectedValue(new Error('API error'));
      mockScheduledTasks.update.mockResolvedValue({ ...task, error_count: 3, enabled: false });

      await (schedulerService as any).processDueTasks();

      // Should update with enabled: false
      expect(mockScheduledTasks.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: expect.objectContaining({
          error_count: 3,
          enabled: false,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });

      // Should notify user via messaging resolver (WhatsApp or Telegram)
      expect(mockMessagingService.sendTextMessage).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('disabled')
      );
    });

    it('prevents overlapping runs with isRunning flag', async () => {
      const task = {
        id: 'task-123',
        tenant_id: 'tenant-456',
        user_phone: '+1234567890',
        task_prompt: 'Slow task',
        task_type: 'reminder',
        is_one_time: true,
        cron_expr: null,
        timezone: 'America/Denver',
        error_count: 0,
        next_run_at: new Date(Date.now() - 60000),
        enabled: true,
      };

      // Make the task execution slow
      mockPrisma.$queryRaw.mockResolvedValue([task]);
      mockMessageProcessor.executeScheduledTask.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('Done'), 100))
      );
      mockPrisma.messages.create.mockResolvedValue({});
      mockScheduledTasks.delete.mockResolvedValue(task);

      // Start first run
      const firstRun = (schedulerService as any).processDueTasks();

      // Try to start second run immediately (should be blocked)
      const secondRun = (schedulerService as any).processDueTasks();

      await Promise.all([firstRun, secondRun]);

      // $queryRaw should only be called once due to isRunning flag
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('start/stop', () => {
    it('starts cron job correctly', () => {
      schedulerService.start();

      expect(cron.schedule).toHaveBeenCalledWith(
        '* * * * *',
        expect.any(Function)
      );
    });

    it('stops cron job correctly', () => {
      schedulerService.start();
      schedulerService.stop();

      const mockCronJob = (cron.schedule as jest.Mock).mock.results[0].value;
      expect(mockCronJob.stop).toHaveBeenCalled();
    });
  });
});
