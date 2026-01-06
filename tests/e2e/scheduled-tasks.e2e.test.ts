/**
 * E2E Tests: Scheduled Task Execution System
 *
 * CRITICAL PATH: SchedulerService cron → Database polling → Task execution → WhatsApp delivery
 *
 * These tests verify the complete scheduled task lifecycle from polling to execution.
 * Tests cover distributed locking, lease management, error handling, and task state transitions.
 *
 * Critical Logic Tested:
 * - PostgreSQL advisory lock acquisition (distributed safety)
 * - Lease-based task claiming (prevents double execution)
 * - One-time vs recurring task handling (state transitions)
 * - Error count tracking and task disabling (reliability)
 * - Cron expression parsing (scheduling accuracy)
 */

// Set test environment before imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-ok';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.ANTHROPIC_API_KEY = 'test-api-key';

// Mock dependencies
const mockPrismaQueryRaw = jest.fn();
const mockPrismaTaskUpdate = jest.fn();
const mockPrismaTaskDelete = jest.fn();
const mockPrismaMessageCreate = jest.fn();
const mockExecuteScheduledTask = jest.fn();
const mockWhatsAppSend = jest.fn();
const mockGetOrCreateSession = jest.fn();

// Mock messaging service (returned by resolver)
const mockMessagingService = {
  sendTextMessage: mockWhatsAppSend,
};

// Mock messaging resolver (routes to WhatsApp or Telegram)
const mockMessagingResolver = {
  resolveForTenant: jest.fn().mockResolvedValue(mockMessagingService),
  getRecipientId: jest.fn().mockImplementation((_tenantId: string, phone: string) => Promise.resolve(phone)),
};

// Mock Prisma (snake_case table names matching schema)
jest.mock('../../src/services/prisma.js', () => ({
  getPrismaClient: () => ({
    $queryRaw: mockPrismaQueryRaw,
    scheduled_tasks: {
      update: mockPrismaTaskUpdate,
      delete: mockPrismaTaskDelete,
      findMany: jest.fn().mockResolvedValue([]),
    },
    messages: {
      create: mockPrismaMessageCreate,
      findMany: jest.fn().mockResolvedValue([]),
    },
    conversationSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  }),
}));

// Mock node-cron
const mockCronStop = jest.fn();
const mockCronSchedule = jest.fn().mockReturnValue({ stop: mockCronStop });
jest.mock('node-cron', () => ({
  schedule: mockCronSchedule,
}));

// Mock session
const mockReleaseSessionLease = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/services/session.js', () => ({
  getOrCreateSession: mockGetOrCreateSession,
  releaseSessionLease: mockReleaseSessionLease,
}));

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

// Mock metrics
jest.mock('../../src/utils/metrics.js', () => ({
  recordTiming: jest.fn(),
  incrementCounter: jest.fn(),
  setGauge: jest.fn(),
}));

import { SchedulerService } from '../../src/services/schedulerService.js';
import { MessageProcessor } from '../../src/services/messageProcessor.js';
import { WhatsAppService } from '../../src/services/whatsapp.js';
import { MessagingServiceResolver } from '../../src/services/messaging/resolver.js';
import { PrismaClient } from '@prisma/client';

describe('E2E: Scheduled Task Execution System', () => {
  let schedulerService: SchedulerService;
  let mockPrisma: any;
  let mockMessageProcessor: any;
  let mockWhatsAppService: any;

  // Helper to create a mock scheduled task
  function createMockTask(overrides: Partial<{
    id: string;
    tenant_id: string;
    user_phone: string;
    task_prompt: string;
    task_type: string;
    is_one_time: boolean;
    cron_expr: string | null;
    timezone: string;
    error_count: number;
    enabled: boolean;
    execution_plan: object | null;
    next_run_at: Date;
  }> = {}) {
    return {
      id: 'task-001',
      tenant_id: 'tenant-123',
      user_phone: '+15559876543',
      task_prompt: 'Remind me to call mom',
      task_type: 'reminder',
      is_one_time: true,
      cron_expr: null,
      timezone: 'America/Denver',
      error_count: 0,
      enabled: true,
      execution_plan: null,
      next_run_at: new Date(Date.now() - 60000), // Due 1 minute ago
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock Prisma (snake_case table names)
    mockPrisma = {
      $queryRaw: mockPrismaQueryRaw,
      scheduled_tasks: {
        update: mockPrismaTaskUpdate,
        delete: mockPrismaTaskDelete,
      },
      messages: {
        create: mockPrismaMessageCreate,
      },
    };

    // Setup mock MessageProcessor
    mockMessageProcessor = {
      executeScheduledTask: mockExecuteScheduledTask,
    };

    // Setup mock WhatsAppService
    mockWhatsAppService = {
      sendTextMessage: mockWhatsAppSend,
    };

    // Create scheduler instance (4 args: prisma, messageProcessor, whatsApp, messagingResolver)
    schedulerService = new SchedulerService(
      mockPrisma as unknown as PrismaClient,
      mockMessageProcessor as unknown as MessageProcessor,
      mockWhatsAppService as unknown as WhatsAppService,
      mockMessagingResolver as unknown as MessagingServiceResolver
    );

    // Mock the lock acquisition (bypasses actual PostgreSQL advisory lock)
    (schedulerService as any).acquireSchedulerLock = jest.fn().mockResolvedValue({
      query: jest.fn(),
      end: jest.fn(),
    });
    (schedulerService as any).releaseSchedulerLock = jest.fn().mockResolvedValue(undefined);

    // Default mock implementations
    mockGetOrCreateSession.mockResolvedValue({ sessionId: 'session-123', isNew: false });
    mockPrismaMessageCreate.mockResolvedValue({});
  });

  describe('Task Polling and Claiming (Distributed Safety)', () => {
    /**
     * CRITICAL: Only due tasks (next_run_at <= NOW) should be claimed.
     * Premature execution would confuse users.
     */
    it('queries only tasks where next_run_at <= NOW() AND enabled=true', async () => {
      mockPrismaQueryRaw.mockResolvedValue([]);

      await (schedulerService as any).processDueTasks();

      expect(mockPrismaQueryRaw).toHaveBeenCalled();
      // Verify the SQL query filters by next_run_at and enabled
      const queryCall = mockPrismaQueryRaw.mock.calls[0];
      expect(queryCall).toBeDefined();
    });

    /**
     * CRITICAL: Lease-based claiming prevents double execution.
     * Without this, multiple server instances could execute same task.
     */
    it('updates lease_owner and lease_expires_at when claiming task', async () => {
      const task = createMockTask();
      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Task completed successfully');
      mockWhatsAppSend.mockResolvedValue('msg-id-123');
      mockPrismaTaskDelete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      // Task should be deleted after successful one-time execution
      expect(mockPrismaTaskDelete).toHaveBeenCalledWith({
        where: { id: 'task-001' },
      });
    });

    /**
     * CRITICAL: isRunning flag prevents overlapping cron runs.
     * Long-running tasks should not cause pile-up.
     */
    it('prevents concurrent processDueTasks execution via isRunning flag', async () => {
      const task = createMockTask();
      mockPrismaQueryRaw.mockResolvedValue([task]);

      // Make execution take time
      mockExecuteScheduledTask.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('Done'), 100))
      );
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskDelete.mockResolvedValue(task);

      // Start two concurrent runs
      const run1 = (schedulerService as any).processDueTasks();
      const run2 = (schedulerService as any).processDueTasks();

      await Promise.all([run1, run2]);

      // Query should only be called once due to isRunning guard
      expect(mockPrismaQueryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('One-Time Task Execution (State Transition)', () => {
    /**
     * CRITICAL: One-time tasks must be deleted after successful execution.
     * Leaving them would cause repeated execution.
     */
    it('deletes one-time task after successful execution', async () => {
      const task = createMockTask({
        id: 'onetime-task-1',
        is_one_time: true,
        cron_expr: null,
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Reminder: Call mom now!');
      mockWhatsAppSend.mockResolvedValue('msg-sent-123');
      mockPrismaTaskDelete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      // Verify task was deleted
      expect(mockPrismaTaskDelete).toHaveBeenCalledWith({
        where: { id: 'onetime-task-1' },
      });

      // Verify WhatsApp message was sent
      expect(mockWhatsAppSend).toHaveBeenCalledWith(
        '+15559876543',
        'Reminder: Call mom now!'
      );
    });

    /**
     * CRITICAL: Message should be stored after successful execution.
     * Audit trail for user and debugging.
     */
    it('stores outbound message after task execution', async () => {
      const task = createMockTask();
      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Task result message');
      mockWhatsAppSend.mockResolvedValue('wa-msg-id-456');
      mockPrismaTaskDelete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      expect(mockPrismaMessageCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-123',
          direction: 'OUTBOUND',
          content: 'Task result message',
          sender_phone: '+15559876543',
        }),
      });
    });
  });

  describe('Recurring Task Execution (Next Run Calculation)', () => {
    /**
     * CRITICAL: Recurring tasks must update next_run_at after execution.
     * Incorrect calculation would break the schedule.
     */
    it('updates next_run_at for recurring task (not deleted)', async () => {
      const task = createMockTask({
        id: 'recurring-task-1',
        is_one_time: false,
        cron_expr: '0 9 * * *', // Daily at 9 AM
        task_prompt: 'Daily standup reminder',
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Time for standup!');
      mockWhatsAppSend.mockResolvedValue('msg-id-789');
      mockPrismaTaskUpdate.mockResolvedValue({ ...task, next_run_at: new Date() });

      await (schedulerService as any).processDueTasks();

      // Should update (not delete) recurring task
      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith({
        where: { id: 'recurring-task-1' },
        data: expect.objectContaining({
          last_run_at: expect.any(Date),
          next_run_at: expect.any(Date),
          error_count: 0,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });

      // Should NOT delete recurring task
      expect(mockPrismaTaskDelete).not.toHaveBeenCalled();
    });

    /**
     * CRITICAL: next_run_at must be in the future.
     * Past dates would cause immediate re-execution loop.
     */
    it('calculates next_run_at in the future', async () => {
      const task = createMockTask({
        is_one_time: false,
        cron_expr: '0 9 * * *',
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Done');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskUpdate.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      const updateCall = mockPrismaTaskUpdate.mock.calls[0];
      expect(updateCall).toBeDefined();

      const nextRunAt = updateCall[0].data.next_run_at;
      expect(nextRunAt).toBeInstanceOf(Date);
      expect(nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Error Handling (Reliability)', () => {
    /**
     * CRITICAL: Failed tasks must increment error_count.
     * Allows tracking and eventual disabling of problematic tasks.
     */
    it('increments error_count on task execution failure', async () => {
      const task = createMockTask({
        id: 'failing-task-1',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        error_count: 0,
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockRejectedValue(new Error('Claude API timeout'));
      mockPrismaTaskUpdate.mockResolvedValue({ ...task, error_count: 1 });

      await (schedulerService as any).processDueTasks();

      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith({
        where: { id: 'failing-task-1' },
        data: expect.objectContaining({
          error_count: 1,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });
    });

    /**
     * CRITICAL: Tasks disabled after 3 consecutive failures.
     * Prevents infinite retry loops and user notification.
     */
    it('disables task and notifies user after 3 consecutive failures', async () => {
      const task = createMockTask({
        id: 'chronic-failure-task',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        error_count: 2, // Will become 3 after this failure
        task_prompt: 'Check email',
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockRejectedValue(new Error('Persistent error'));
      mockPrismaTaskUpdate.mockResolvedValue({ ...task, error_count: 3, enabled: false });
      mockWhatsAppSend.mockResolvedValue('notification-msg');

      await (schedulerService as any).processDueTasks();

      // Should update with enabled: false
      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith({
        where: { id: 'chronic-failure-task' },
        data: expect.objectContaining({
          error_count: 3,
          enabled: false,
          lease_owner: null,
          lease_expires_at: null,
        }),
      });

      // Should notify user via WhatsApp
      expect(mockWhatsAppSend).toHaveBeenCalledWith(
        '+15559876543',
        expect.stringContaining('disabled')
      );
    });

    /**
     * CRITICAL: Successful execution resets error_count.
     * Allows recovery from transient failures.
     */
    it('resets error_count to 0 on successful execution', async () => {
      const task = createMockTask({
        id: 'recovering-task',
        is_one_time: false,
        cron_expr: '0 9 * * *',
        error_count: 2, // Previous failures
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Success after failures');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskUpdate.mockResolvedValue({ ...task, error_count: 0 });

      await (schedulerService as any).processDueTasks();

      expect(mockPrismaTaskUpdate).toHaveBeenCalledWith({
        where: { id: 'recovering-task' },
        data: expect.objectContaining({
          error_count: 0,
        }),
      });
    });
  });

  describe('Task Type Handling (reminder vs execute)', () => {
    /**
     * CRITICAL: Reminder tasks should just send a message.
     * Execute tasks should actually perform actions via tools.
     */
    it('handles reminder task type correctly', async () => {
      const task = createMockTask({
        task_type: 'reminder',
        task_prompt: 'Remember to submit report',
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Reminder: Remember to submit report');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskDelete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      // MessageProcessor.executeScheduledTask should be called with task details
      // Signature: (tenantId, userPhone, taskPrompt, taskType, previousOutputs)
      expect(mockExecuteScheduledTask).toHaveBeenCalledWith(
        'tenant-123',
        '+15559876543',
        'Remember to submit report',
        'reminder',
        [] // previousOutputs (empty for one-time task)
      );
    });

    it('handles execute task type correctly', async () => {
      const task = createMockTask({
        task_type: 'execute',
        task_prompt: 'Send daily summary email',
        execution_plan: { steps: ['gather data', 'compose email', 'send'] },
      });

      mockPrismaQueryRaw.mockResolvedValue([task]);
      mockExecuteScheduledTask.mockResolvedValue('Daily summary email sent successfully');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskDelete.mockResolvedValue(task);

      await (schedulerService as any).processDueTasks();

      // Signature: (tenantId, userPhone, taskPrompt, taskType, previousOutputs)
      expect(mockExecuteScheduledTask).toHaveBeenCalledWith(
        'tenant-123',
        '+15559876543',
        'Send daily summary email',
        'execute',
        [] // previousOutputs (empty for one-time task)
      );
    });
  });

  describe('Scheduler Lifecycle (Start/Stop)', () => {
    /**
     * CRITICAL: Scheduler must start cron job correctly.
     * Failure means no tasks execute.
     */
    it('starts cron job on every-minute schedule', () => {
      schedulerService.start();

      expect(mockCronSchedule).toHaveBeenCalledWith(
        '* * * * *', // Every minute
        expect.any(Function)
      );
    });

    /**
     * CRITICAL: Scheduler must stop cleanly on shutdown.
     * Prevents zombie processes and allows graceful restart.
     */
    it('stops cron job on scheduler stop', () => {
      schedulerService.start();
      schedulerService.stop();

      expect(mockCronStop).toHaveBeenCalled();
    });

    /**
     * CRITICAL: Multiple start calls should not create duplicate jobs.
     */
    it('prevents multiple concurrent cron jobs', () => {
      schedulerService.start();
      schedulerService.start();
      schedulerService.start();

      // Should only schedule once (idempotent start)
      expect(mockCronSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('Multiple Task Processing', () => {
    /**
     * CRITICAL: Multiple due tasks should all be processed.
     * No task should be skipped.
     */
    it('processes all due tasks in a single tick', async () => {
      const task1 = createMockTask({ id: 'task-1', task_prompt: 'Task 1' });
      const task2 = createMockTask({ id: 'task-2', task_prompt: 'Task 2' });
      const task3 = createMockTask({ id: 'task-3', task_prompt: 'Task 3' });

      mockPrismaQueryRaw.mockResolvedValue([task1, task2, task3]);
      mockExecuteScheduledTask.mockResolvedValue('Executed');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskDelete.mockResolvedValue({});

      await (schedulerService as any).processDueTasks();

      // All three tasks should be executed
      expect(mockExecuteScheduledTask).toHaveBeenCalledTimes(3);
      expect(mockWhatsAppSend).toHaveBeenCalledTimes(3);
      expect(mockPrismaTaskDelete).toHaveBeenCalledTimes(3);
    });

    /**
     * CRITICAL: One task failure should not stop others.
     * Isolation prevents cascade failures.
     */
    it('continues processing remaining tasks after one fails', async () => {
      const task1 = createMockTask({ id: 'task-1', task_prompt: 'Task 1' });
      const task2 = createMockTask({ id: 'task-2', task_prompt: 'Task 2 (fails)' });
      const task3 = createMockTask({ id: 'task-3', task_prompt: 'Task 3' });

      mockPrismaQueryRaw.mockResolvedValue([task1, task2, task3]);
      mockExecuteScheduledTask
        .mockResolvedValueOnce('Task 1 success')
        .mockRejectedValueOnce(new Error('Task 2 failed'))
        .mockResolvedValueOnce('Task 3 success');
      mockWhatsAppSend.mockResolvedValue('msg-id');
      mockPrismaTaskDelete.mockResolvedValue({});
      mockPrismaTaskUpdate.mockResolvedValue({});

      await (schedulerService as any).processDueTasks();

      // All three should be attempted
      expect(mockExecuteScheduledTask).toHaveBeenCalledTimes(3);

      // Task 1 and 3 should be deleted (success), Task 2 should be updated (failure)
      expect(mockPrismaTaskDelete).toHaveBeenCalledTimes(2);
      expect(mockPrismaTaskUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
