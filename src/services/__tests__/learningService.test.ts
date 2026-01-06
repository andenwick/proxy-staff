import { LearningService } from '../learningService.js';
import { ClaudeCliService } from '../claudeCli.js';
import { logger } from '../../utils/logger.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockedLogger = jest.mocked(logger);

// Mock ClaudeCliService
const mockClaudeCliService = {
  sendMessage: jest.fn(),
  resetSession: jest.fn(),
};

describe('LearningService', () => {
  let service: LearningService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LearningService(mockClaudeCliService as unknown as ClaudeCliService);
  });

  describe('triggerConversationEndLearning', () => {
    const tenantId = 'tenant-123';
    const senderPhone = '+1234567890';

    it('sends reflection prompt to Claude CLI', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone, 'reset');

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        tenantId,
        senderPhone,
        expect.stringContaining('[CONVERSATION REFLECTION - RESET]')
      );
    });

    it('includes expiry reason in prompt', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone, 'expiry');

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        tenantId,
        senderPhone,
        expect.stringContaining('[CONVERSATION REFLECTION - EXPIRY]')
      );
    });

    it('includes manual reason in prompt', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone, 'manual');

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        tenantId,
        senderPhone,
        expect.stringContaining('[CONVERSATION REFLECTION - MANUAL]')
      );
    });

    it('defaults to reset reason', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone);

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        tenantId,
        senderPhone,
        expect.stringContaining('[CONVERSATION REFLECTION - RESET]')
      );
    });

    it('logs start and completion', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone, 'reset');

      expect(mockedLogger.info).toHaveBeenCalledWith(
        { tenantId, senderPhone, reason: 'reset' },
        'Triggering end-of-conversation learning'
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        { tenantId, senderPhone, reason: 'reset' },
        'End-of-conversation learning completed'
      );
    });

    it('does not throw on error - logs instead', async () => {
      mockClaudeCliService.sendMessage.mockRejectedValue(new Error('CLI failed'));

      // Should not throw
      await service.triggerConversationEndLearning(tenantId, senderPhone, 'reset');

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, senderPhone, reason: 'reset' }),
        'End-of-conversation learning failed'
      );
    });

    it('includes all learning categories in prompt', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Reflection complete');

      await service.triggerConversationEndLearning(tenantId, senderPhone, 'reset');

      const callArgs = mockClaudeCliService.sendMessage.mock.calls[0];
      const prompt = callArgs[2];

      // Verify all 5 learning categories are mentioned
      expect(prompt).toContain('Identity/Preferences');
      expect(prompt).toContain('Patterns');
      expect(prompt).toContain('Relationships');
      expect(prompt).toContain('Business Knowledge');
      expect(prompt).toContain('Boundaries');
    });
  });

  describe('triggerPeriodicLearning', () => {
    const tenantId = 'tenant-123';

    it('sends periodic review prompt to Claude CLI', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Review complete');

      await service.triggerPeriodicLearning(tenantId);

      expect(mockClaudeCliService.sendMessage).toHaveBeenCalledWith(
        tenantId,
        'system:periodic-learning', // PERIODIC_LEARNING_SENDER constant
        expect.stringContaining('[PERIODIC LEARNING REVIEW]')
      );
    });

    it('includes search_history instruction', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Review complete');

      await service.triggerPeriodicLearning(tenantId);

      const callArgs = mockClaudeCliService.sendMessage.mock.calls[0];
      const prompt = callArgs[2];

      expect(prompt).toContain('search_history');
      expect(prompt).toContain('24 hours');
    });

    it('logs start and completion', async () => {
      mockClaudeCliService.sendMessage.mockResolvedValue('Review complete');

      await service.triggerPeriodicLearning(tenantId);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        { tenantId },
        'Triggering periodic learning review'
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        { tenantId },
        'Periodic learning review completed'
      );
    });

    it('throws on error (for scheduler to handle)', async () => {
      mockClaudeCliService.sendMessage.mockRejectedValue(new Error('CLI failed'));

      await expect(service.triggerPeriodicLearning(tenantId)).rejects.toThrow('CLI failed');
    });
  });

  describe('resetPeriodicSession', () => {
    const tenantId = 'tenant-123';

    it('resets session for periodic learning sender', async () => {
      mockClaudeCliService.resetSession.mockResolvedValue(undefined);

      await service.resetPeriodicSession(tenantId);

      expect(mockClaudeCliService.resetSession).toHaveBeenCalledWith(
        tenantId,
        'system:periodic-learning'
      );
    });

    it('logs error but does not throw on failure', async () => {
      mockClaudeCliService.resetSession.mockRejectedValue(new Error('Reset failed'));

      // Should not throw
      await service.resetPeriodicSession(tenantId);

      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId }),
        'Failed to reset periodic learning session'
      );
    });
  });
});
