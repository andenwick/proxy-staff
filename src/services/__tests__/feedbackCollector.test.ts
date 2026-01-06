/**
 * FeedbackCollector Service Tests
 */

import { FeedbackCollector } from '../feedbackCollector.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('FeedbackCollector', () => {
  let mockPrisma: any;
  let collector: FeedbackCollector;

  beforeEach(() => {
    mockPrisma = {
      feedback_signals: {
        create: jest.fn().mockResolvedValue({ id: 'signal-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    collector = new FeedbackCollector(mockPrisma);
  });

  describe('detectCorrection', () => {
    it('detects "no that is wrong"', () => {
      expect(collector.detectCorrection('no that is wrong')).toBe(true);
    });

    it('detects "not what I asked for"', () => {
      expect(collector.detectCorrection('not what I asked for')).toBe(true);
    });

    it('detects "I said something else"', () => {
      expect(collector.detectCorrection('I said something else')).toBe(true);
    });

    it('detects "I meant the other option"', () => {
      expect(collector.detectCorrection('I meant the other option')).toBe(true);
    });

    it('detects "actually I want something different"', () => {
      expect(collector.detectCorrection('actually I want something different')).toBe(true);
    });

    it('detects "thats not correct"', () => {
      expect(collector.detectCorrection('thats not correct')).toBe(true);
    });

    it('does not detect normal messages', () => {
      expect(collector.detectCorrection('thank you for the help')).toBe(false);
      expect(collector.detectCorrection('please send the email')).toBe(false);
      expect(collector.detectCorrection('that sounds good')).toBe(false);
    });
  });

  describe('detectComplaint', () => {
    it('detects "you keep making mistakes"', () => {
      expect(collector.detectComplaint('you keep making mistakes')).toBe(true);
    });

    it('detects "why cant you do this"', () => {
      expect(collector.detectComplaint('why cant you do this')).toBe(true);
    });

    it('detects "this is frustrating"', () => {
      expect(collector.detectComplaint('this is frustrating')).toBe(true);
    });

    it('detects "useless response"', () => {
      expect(collector.detectComplaint('useless response')).toBe(true);
    });

    it('detects "it doesnt work"', () => {
      expect(collector.detectComplaint('it doesnt work')).toBe(true);
    });

    it('detects "stop doing that"', () => {
      expect(collector.detectComplaint('stop doing that')).toBe(true);
    });

    it('does not detect normal messages', () => {
      expect(collector.detectComplaint('can you help me')).toBe(false);
      expect(collector.detectComplaint('sounds good')).toBe(false);
      expect(collector.detectComplaint('please continue')).toBe(false);
    });
  });

  describe('recordSignal', () => {
    it('creates a signal in database', async () => {
      const signalId = await collector.recordSignal(
        'tenant-1',
        'session-1',
        'USER_CORRECTION',
        { userMessage: 'no that is wrong' },
        'warning'
      );

      expect(signalId).toBe('signal-1');
      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          session_id: 'session-1',
          signal_type: 'USER_CORRECTION',
          signal_data: { userMessage: 'no that is wrong' },
          severity: 'warning',
          tool_execution_id: undefined,
        },
      });
    });

    it('includes tool_execution_id when provided', async () => {
      await collector.recordSignal(
        'tenant-1',
        'session-1',
        'TOOL_FAILURE',
        { error: 'timeout' },
        'error',
        'exec-1'
      );

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tool_execution_id: 'exec-1',
        }),
      });
    });

    it('defaults severity to info', async () => {
      await collector.recordSignal(
        'tenant-1',
        'session-1',
        'USER_CORRECTION',
        {}
      );

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          severity: 'info',
        }),
      });
    });
  });

  describe('analyzeUserMessage', () => {
    it('records correction signal when correction detected', async () => {
      await collector.analyzeUserMessage('tenant-1', 'session-1', 'no that is wrong');

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signal_type: 'USER_CORRECTION',
          severity: 'warning',
        }),
      });
    });

    it('records complaint signal when complaint detected', async () => {
      await collector.analyzeUserMessage('tenant-1', 'session-1', 'this is so frustrating');

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signal_type: 'USER_COMPLAINT',
          severity: 'error',
        }),
      });
    });

    it('records both signals when message has correction and complaint', async () => {
      await collector.analyzeUserMessage('tenant-1', 'session-1', 'no that is wrong and you keep making mistakes');

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledTimes(2);
    });

    it('does not record signals for normal messages', async () => {
      await collector.analyzeUserMessage('tenant-1', 'session-1', 'thanks for the help');

      expect(mockPrisma.feedback_signals.create).not.toHaveBeenCalled();
    });
  });

  describe('recordToolFailure', () => {
    it('records tool failure with execution id', async () => {
      await collector.recordToolFailure(
        'tenant-1',
        'session-1',
        'exec-1',
        'send_email',
        'Connection timeout'
      );

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signal_type: 'TOOL_FAILURE',
          signal_data: { toolName: 'send_email', errorMessage: 'Connection timeout' },
          severity: 'error',
          tool_execution_id: 'exec-1',
        }),
      });
    });
  });

  describe('recordGuardTriggered', () => {
    it('records guard triggered signal', async () => {
      await collector.recordGuardTriggered(
        'tenant-1',
        'session-1',
        'delete all files',
        'I cannot perform destructive actions'
      );

      expect(mockPrisma.feedback_signals.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signal_type: 'GUARD_TRIGGERED',
          signal_data: {
            userMessage: 'delete all files',
            guardedResponse: 'I cannot perform destructive actions',
          },
          severity: 'warning',
        }),
      });
    });
  });

  describe('getUnprocessedSignals', () => {
    it('returns unprocessed signals for tenant', async () => {
      const mockSignals = [
        {
          id: 'sig-1',
          signal_type: 'USER_CORRECTION',
          signal_data: { userMessage: 'wrong' },
          severity: 'warning',
          created_at: new Date('2025-01-01'),
        },
      ];
      mockPrisma.feedback_signals.findMany.mockResolvedValue(mockSignals);

      const signals = await collector.getUnprocessedSignals('tenant-1');

      expect(signals).toEqual([{
        id: 'sig-1',
        signalType: 'USER_CORRECTION',
        signalData: { userMessage: 'wrong' },
        severity: 'warning',
        createdAt: new Date('2025-01-01'),
      }]);
      expect(mockPrisma.feedback_signals.findMany).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', processed: false },
        select: expect.any(Object),
        orderBy: { created_at: 'desc' },
        take: 100,
      });
    });
  });

  describe('markProcessed', () => {
    it('updates signals as processed', async () => {
      await collector.markProcessed(['sig-1', 'sig-2'], 'improvement-1');

      expect(mockPrisma.feedback_signals.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['sig-1', 'sig-2'] } },
        data: { processed: true, improvement_id: 'improvement-1' },
      });
    });
  });

  describe('getSignalCounts', () => {
    it('returns signal counts by type', async () => {
      mockPrisma.feedback_signals.groupBy.mockResolvedValue([
        { signal_type: 'USER_CORRECTION', _count: 5 },
        { signal_type: 'TOOL_FAILURE', _count: 3 },
      ]);

      const counts = await collector.getSignalCounts('tenant-1', 24);

      expect(counts).toEqual({
        USER_CORRECTION: 5,
        TOOL_FAILURE: 3,
      });
    });

    it('returns empty object when no signals', async () => {
      mockPrisma.feedback_signals.groupBy.mockResolvedValue([]);

      const counts = await collector.getSignalCounts('tenant-1');

      expect(counts).toEqual({});
    });
  });
});
