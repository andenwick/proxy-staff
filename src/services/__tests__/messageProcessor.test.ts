/**
 * MessageProcessor Tests
 *
 * Tests for message processing, channel routing, error handling,
 * and command handling functionality.
 */

import { MessageProcessor } from '../messageProcessor.js';
import { ClaudeCliError, ToolExecutionError } from '../../errors/index.js';

// Mock all external dependencies
jest.mock('../session.js', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: 'test-session-id', isNew: false }),
  endSession: jest.fn().mockResolvedValue(undefined),
  createSession: jest.fn().mockResolvedValue('new-session-id'),
  releaseSessionLease: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../queue/index.js', () => ({
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(undefined),
  addJob: jest.fn().mockResolvedValue('job-id-123'),
  isRedisHealthy: jest.fn().mockResolvedValue(false), // Default to sync mode
  canQueue: jest.fn().mockResolvedValue({ allowed: true }),
  interruptUserJob: jest.fn().mockResolvedValue({ interrupted: false }),
  hasActiveJob: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../config/index.js', () => ({
  getConfig: jest.fn(() => ({
    sessionTimeoutHours: 24,
    queue: {
      asyncTaskThresholdMs: 30000,
    },
  })),
}));

jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../utils/metrics.js', () => ({
  incrementCounter: jest.fn(),
  recordTiming: jest.fn(),
}));

jest.mock('../../utils/taskEstimator.js', () => ({
  estimateTaskDuration: jest.fn().mockReturnValue(1000), // Default to quick task
}));

jest.mock('../index.js', () => ({
  getFeedbackCollector: jest.fn(() => ({
    analyzeUserMessage: jest.fn().mockResolvedValue(undefined),
  })),
  getTenantFolderService: jest.fn(() => ({
    initializeTenantForCli: jest.fn().mockResolvedValue(undefined),
    getTenantFolder: jest.fn().mockReturnValue('/mock/tenant/folder'),
  })),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(new Error('File not found')),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../queue/cliSessionStore.js', () => ({
  getSession: jest.fn().mockReturnValue(null),
  createSession: jest.fn().mockResolvedValue({
    tenantId: 'tenant-123',
    senderPhone: '+1234567890',
    sessionId: 'test-session-id',
    cliSessionId: 'cli-session-123',
    process: { killed: false },
    lastMessageAt: new Date(),
    messageCount: 0,
    isProcessing: false,
    isInitialized: true,
    pendingMessages: [],
    outputBuffer: '',
  }),
  injectMessage: jest.fn().mockResolvedValue('AI response from CLI'),
  closeSession: jest.fn().mockResolvedValue(undefined),
  hasSession: jest.fn().mockReturnValue(false),
}));

// Import mocked modules
import { getOrCreateSession, endSession, createSession } from '../session.js';
import { acquireLock, releaseLock, interruptUserJob, hasActiveJob, isRedisHealthy, addJob, canQueue } from '../queue/index.js';
import { estimateTaskDuration } from '../../utils/taskEstimator.js';
import { injectMessage, createSession as createCliSession, closeSession as closeCliSession } from '../queue/cliSessionStore.js';

describe('MessageProcessor', () => {
  let messageProcessor: MessageProcessor;
  let mockPrisma: any;
  let mockWhatsAppService: any;
  let mockClaudeCliService: any;
  let mockTenantFolderService: any;
  let mockMessagingResolver: any;
  let mockLearningService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset all queue mocks to default values
    (acquireLock as jest.Mock).mockResolvedValue(true);
    (releaseLock as jest.Mock).mockResolvedValue(undefined);
    (addJob as jest.Mock).mockResolvedValue('job-id-123');
    (isRedisHealthy as jest.Mock).mockResolvedValue(false);
    (canQueue as jest.Mock).mockResolvedValue({ allowed: true });
    (interruptUserJob as jest.Mock).mockResolvedValue({ interrupted: false });
    (hasActiveJob as jest.Mock).mockResolvedValue(false);
    (estimateTaskDuration as jest.Mock).mockReturnValue(1000);
    (getOrCreateSession as jest.Mock).mockResolvedValue({ sessionId: 'test-session-id', isNew: false });

    // Mock Prisma client
    mockPrisma = {
      messages: {
        create: jest.fn().mockResolvedValue({ id: 'msg-id' }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ onboarding_status: 'LIVE' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    // Mock WhatsApp service
    mockWhatsAppService = {
      sendTextMessage: jest.fn().mockResolvedValue('whatsapp-msg-id'),
    };

    // Mock Claude CLI service
    mockClaudeCliService = {
      sendMessage: jest.fn().mockResolvedValue('Hello! How can I help you?'),
      resetSession: jest.fn().mockResolvedValue(undefined),
    };

    // Mock Tenant Folder service
    mockTenantFolderService = {
      initializeTenantForCli: jest.fn().mockResolvedValue(undefined),
      getTenantFolder: jest.fn().mockReturnValue('/tenants/test-tenant'),
    };

    // Mock messaging resolver (multi-channel)
    mockMessagingResolver = {
      resolveForTenant: jest.fn().mockResolvedValue({
        sendTextMessage: jest.fn().mockResolvedValue('resolved-msg-id'),
      }),
      getRecipientId: jest.fn().mockResolvedValue('+1234567890'),
    };

    // Mock learning service
    mockLearningService = {
      triggerConversationEndLearning: jest.fn().mockResolvedValue(undefined),
    };

    // Create message processor
    messageProcessor = new MessageProcessor(
      mockPrisma,
      mockWhatsAppService,
      mockClaudeCliService,
      mockTenantFolderService,
      mockMessagingResolver,
      mockLearningService
    );
  });

  describe('processIncomingMessage', () => {
    it('successfully processes a normal message', async () => {
      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello, how are you?',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      expect(result.replyMessageId).toBeDefined();
      // Uses CLI session store's injectMessage
      expect(injectMessage).toHaveBeenCalled();
    });

    it('rejects messages that exceed maximum length', async () => {
      const longMessage = 'a'.repeat(5000);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        longMessage,
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Message exceeds maximum length');
      expect(injectMessage).not.toHaveBeenCalled();
    });

    it('rejects empty messages', async () => {
      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '   ',
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty message');
      expect(injectMessage).not.toHaveBeenCalled();
    });

    it('handles /reset command', async () => {
      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '/reset',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      expect(endSession).toHaveBeenCalled();
      expect(createSession).toHaveBeenCalledWith('tenant-123', '+1234567890');
      // CLI session is closed via closeCliSession
      expect(closeCliSession).toHaveBeenCalledWith('tenant-123', '+1234567890');
      expect(mockLearningService.triggerConversationEndLearning).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        'reset'
      );
    });

    it('handles /new command (same as /reset)', async () => {
      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '/new',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      expect(endSession).toHaveBeenCalled();
      expect(createSession).toHaveBeenCalled();
    });

    it('handles /reonboard command', async () => {
      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '/reonboard',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-123' },
        data: { onboarding_status: 'DISCOVERY' },
      });
    });

    it('handles /cancel command when no session is running', async () => {
      const { hasSession } = require('../queue/cliSessionStore.js');
      (hasSession as jest.Mock).mockReturnValue(false);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '/cancel',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      // closeCliSession should not be called when no session exists
    });

    it('handles /cancel command when session is running', async () => {
      const { hasSession, closeSession } = require('../queue/cliSessionStore.js');
      (hasSession as jest.Mock).mockReturnValue(true);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        '/cancel',
        'wa-msg-123'
      );

      expect(result.success).toBe(true);
      expect(closeSession).toHaveBeenCalledWith('tenant-123', '+1234567890');
    });

    it('routes messages via messaging resolver when available', async () => {
      const mockResolvedService = {
        sendTextMessage: jest.fn().mockResolvedValue('resolved-msg-id'),
      };
      mockMessagingResolver.resolveForTenant.mockResolvedValue(mockResolvedService);

      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(mockMessagingResolver.resolveForTenant).toHaveBeenCalledWith('tenant-123');
      expect(mockMessagingResolver.getRecipientId).toHaveBeenCalledWith('tenant-123', '+1234567890');
    });

    it('triggers learning when session expires and is renewed', async () => {
      (getOrCreateSession as jest.Mock).mockResolvedValue({ sessionId: 'new-session', isNew: true });

      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(mockLearningService.triggerConversationEndLearning).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        'expiry'
      );
      // CLI session is reset via claudeCliService, not closeCliSession
      expect(mockClaudeCliService.resetSession).toHaveBeenCalledWith('tenant-123', '+1234567890');
    });

    // Note: Tests for interruptUserJob, acquireLock, addJob, canQueue removed
    // These features no longer exist in the current CLI-based implementation
  });

  describe('error handling', () => {
    beforeEach(() => {
      // Ensure lock is acquired for error tests
      (acquireLock as jest.Mock).mockResolvedValue(true);
    });

    it('handles ClaudeCliError with timeout message', async () => {
      const timeoutError = new ClaudeCliError('Request timed out');
      (injectMessage as jest.Mock).mockRejectedValueOnce(timeoutError);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timed out');
    });

    it('handles ClaudeCliError with generic message', async () => {
      const cliError = new ClaudeCliError('Some CLI error');
      (injectMessage as jest.Mock).mockRejectedValueOnce(cliError);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
    });

    it('handles ToolExecutionError', async () => {
      const toolError = new ToolExecutionError('Tool failed');
      (injectMessage as jest.Mock).mockRejectedValueOnce(toolError);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool failed');
    });

    it('handles generic errors', async () => {
      const genericError = new Error('Unknown error');
      (injectMessage as jest.Mock).mockRejectedValueOnce(genericError);

      const result = await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });
  });

  describe('executeScheduledTask', () => {
    it('executes a reminder task', async () => {
      const response = await messageProcessor.executeScheduledTask(
        'tenant-123',
        '+1234567890',
        'Call mom',
        'reminder'
      );

      expect(response).toBe('Hello! How can I help you?');
      expect(mockTenantFolderService.initializeTenantForCli).toHaveBeenCalledWith('tenant-123');
      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        expect.stringContaining('SCHEDULED REMINDER')
      );
    });

    it('executes an execute-type task', async () => {
      const response = await messageProcessor.executeScheduledTask(
        'tenant-123',
        '+1234567890',
        'Send daily summary',
        'execute'
      );

      expect(response).toBe('Hello! How can I help you?');
      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        expect.stringContaining('SCHEDULED TASK - EXECUTE')
      );
    });

    it('includes previous outputs context for recurring tasks', async () => {
      const previousOutputs = ['Summary 1', 'Summary 2'];

      await messageProcessor.executeScheduledTask(
        'tenant-123',
        '+1234567890',
        'Send daily summary',
        'execute',
        previousOutputs
      );

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        expect.stringContaining('PREVIOUS OUTPUTS')
      );
    });
  });

  describe('onboarding context', () => {
    beforeEach(() => {
      // Ensure lock is acquired for onboarding tests
      (acquireLock as jest.Mock).mockResolvedValue(true);
    });

    it('adds DISCOVERY context for discovery mode', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ onboarding_status: 'DISCOVERY' });

      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(injectMessage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('ONBOARDING: DISCOVERY MODE')
      );
    });

    it('adds BUILDING context for building mode', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ onboarding_status: 'BUILDING' });

      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(injectMessage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('ONBOARDING: BUILDING MODE')
      );
    });

    it('adds no context for LIVE status', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({ onboarding_status: 'LIVE' });

      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      // Should not contain onboarding context - message is second argument
      const callArgs = (injectMessage as jest.Mock).mock.calls[0];
      expect(callArgs[1]).not.toContain('ONBOARDING:');
    });
  });

  describe('message storage', () => {
    beforeEach(() => {
      // Ensure lock is acquired for storage tests
      (acquireLock as jest.Mock).mockResolvedValue(true);
    });

    it('stores inbound message', async () => {
      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(mockPrisma.messages.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-123',
          sender_phone: '+1234567890',
          direction: 'INBOUND',
          content: 'Hello',
          delivery_status: 'DELIVERED',
        }),
      });
    });

    it('stores outbound message', async () => {
      await messageProcessor.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      // Second call should be for outbound message
      expect(mockPrisma.messages.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-123',
          direction: 'OUTBOUND',
          delivery_status: 'SENT',
        }),
      });
    });
  });

  describe('fallback to WhatsApp service', () => {
    beforeEach(() => {
      // Ensure lock is acquired for fallback tests
      (acquireLock as jest.Mock).mockResolvedValue(true);
    });

    it('uses WhatsApp service directly when no resolver', async () => {
      // Create processor without messaging resolver
      const processorWithoutResolver = new MessageProcessor(
        mockPrisma,
        mockWhatsAppService,
        mockClaudeCliService,
        mockTenantFolderService
      );

      await processorWithoutResolver.processIncomingMessage(
        'tenant-123',
        '+1234567890',
        'Hello',
        'wa-msg-123'
      );

      expect(mockWhatsAppService.sendTextMessage).toHaveBeenCalled();
    });
  });
});
