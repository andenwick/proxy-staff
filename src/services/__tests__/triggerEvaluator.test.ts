import { TriggerEvaluatorService } from '../triggerEvaluator.js';
import { MessageProcessor } from '../messageProcessor.js';
import { WhatsAppService } from '../whatsapp.js';
import { MessagingServiceResolver } from '../messaging/resolver.js';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
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

// Mock metrics
jest.mock('../../utils/metrics.js', () => ({
  recordTiming: jest.fn(),
  incrementCounter: jest.fn(),
}));

// Mock encryption
jest.mock('../../utils/encryption.js', () => ({
  encryptCredential: jest.fn((val) => `encrypted:${val}`),
  decryptCredential: jest.fn((val) => val.replace('encrypted:', '')),
}));

// Mock session helper
jest.mock('../session.js', () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: 'session-123' }),
  releaseSessionLease: jest.fn().mockResolvedValue(undefined),
}));

// Create mocks
const mockPrisma = {
  triggers: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  trigger_executions: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  messages: {
    create: jest.fn(),
  },
} as unknown as PrismaClient;

const mockMessageProcessor = {
  executeScheduledTask: jest.fn(),
} as unknown as MessageProcessor;

const mockWhatsappService = {
  sendTextMessage: jest.fn(),
} as unknown as WhatsAppService;

const mockMessagingResolver = {
  resolveForTenant: jest.fn(),
  getRecipientId: jest.fn(),
} as unknown as MessagingServiceResolver;

describe('TriggerEvaluatorService', () => {
  let service: TriggerEvaluatorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TriggerEvaluatorService(
      mockPrisma,
      mockMessageProcessor,
      mockWhatsappService,
      mockMessagingResolver
    );
  });

  afterEach(async () => {
    await service.stop();
  });

  describe('evaluateCondition', () => {
    describe('numeric comparisons', () => {
      it('evaluates less than correctly', () => {
        expect(service.evaluateCondition('value < 100', 50)).toBe(true);
        expect(service.evaluateCondition('value < 100', 100)).toBe(false);
        expect(service.evaluateCondition('value < 100', 150)).toBe(false);
      });

      it('evaluates greater than correctly', () => {
        expect(service.evaluateCondition('value > 100', 150)).toBe(true);
        expect(service.evaluateCondition('value > 100', 100)).toBe(false);
        expect(service.evaluateCondition('value > 100', 50)).toBe(false);
      });

      it('evaluates less than or equal correctly', () => {
        expect(service.evaluateCondition('value <= 100', 50)).toBe(true);
        expect(service.evaluateCondition('value <= 100', 100)).toBe(true);
        expect(service.evaluateCondition('value <= 100', 150)).toBe(false);
      });

      it('evaluates greater than or equal correctly', () => {
        expect(service.evaluateCondition('value >= 100', 150)).toBe(true);
        expect(service.evaluateCondition('value >= 100', 100)).toBe(true);
        expect(service.evaluateCondition('value >= 100', 50)).toBe(false);
      });

      it('handles decimal numbers', () => {
        expect(service.evaluateCondition('price > 49.99', 50.00)).toBe(true);
        expect(service.evaluateCondition('price <= 49.99', 49.99)).toBe(true);
      });

      it('handles string numbers', () => {
        expect(service.evaluateCondition('value < 100', '50')).toBe(true);
        expect(service.evaluateCondition('value > 100', '150')).toBe(true);
      });
    });

    describe('equality comparisons', () => {
      it('evaluates equality correctly', () => {
        expect(service.evaluateCondition("status == 'active'", 'active')).toBe(true);
        expect(service.evaluateCondition("status == 'active'", 'inactive')).toBe(false);
      });

      it('evaluates inequality correctly', () => {
        expect(service.evaluateCondition("status != 'active'", 'inactive')).toBe(true);
        expect(service.evaluateCondition("status != 'active'", 'active')).toBe(false);
      });

      it('handles boolean values', () => {
        expect(service.evaluateCondition('flag == true', true)).toBe(true);
        expect(service.evaluateCondition('flag == false', false)).toBe(true);
        expect(service.evaluateCondition('flag != true', false)).toBe(true);
      });
    });

    describe('string operations', () => {
      it('evaluates contains correctly', () => {
        expect(service.evaluateCondition("text contains 'error'", 'An error occurred')).toBe(true);
        expect(service.evaluateCondition("text contains 'error'", 'All good')).toBe(false);
      });

      it('evaluates startsWith correctly', () => {
        expect(service.evaluateCondition("msg startsWith 'Hello'", 'Hello World')).toBe(true);
        expect(service.evaluateCondition("msg startsWith 'Hello'", 'World Hello')).toBe(false);
      });

      it('evaluates endsWith correctly', () => {
        expect(service.evaluateCondition("file endsWith '.pdf'", 'document.pdf')).toBe(true);
        expect(service.evaluateCondition("file endsWith '.pdf'", 'document.doc')).toBe(false);
      });

      it('handles case sensitivity', () => {
        expect(service.evaluateCondition("text contains 'ERROR'", 'An error occurred')).toBe(false);
        expect(service.evaluateCondition("text contains 'error'", 'An ERROR occurred')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('returns false for invalid expressions', () => {
        expect(service.evaluateCondition('invalid expression', 100)).toBe(false);
        expect(service.evaluateCondition('', 100)).toBe(false);
      });

      it('handles null/undefined values safely', () => {
        expect(service.evaluateCondition('value > 0', null as any)).toBe(false);
        expect(service.evaluateCondition('value > 0', undefined as any)).toBe(false);
      });
    });
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'my-secret-key';
    const encryptedSecret = `encrypted:${secret}`;
    const payload = '{"event":"test","data":{}}';

    it('verifies valid HMAC-SHA256 signature', () => {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const result = service.verifyWebhookSignature(
        payload,
        expectedSignature,
        encryptedSecret,
        'hmac-sha256'
      );

      expect(result).toBe(true);
    });

    it('verifies valid HMAC-SHA1 signature', () => {
      const expectedSignature = crypto
        .createHmac('sha1', secret)
        .update(payload)
        .digest('hex');

      const result = service.verifyWebhookSignature(
        payload,
        expectedSignature,
        encryptedSecret,
        'hmac-sha1'
      );

      expect(result).toBe(true);
    });

    it('rejects invalid signature', () => {
      const result = service.verifyWebhookSignature(
        payload,
        'invalid-signature',
        encryptedSecret,
        'hmac-sha256'
      );

      expect(result).toBe(false);
    });

    it('rejects tampered payload', () => {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const result = service.verifyWebhookSignature(
        '{"event":"tampered","data":{}}',
        expectedSignature,
        encryptedSecret,
        'hmac-sha256'
      );

      expect(result).toBe(false);
    });

    it('handles signature length mismatch gracefully', () => {
      const result = service.verifyWebhookSignature(
        payload,
        'short',
        encryptedSecret,
        'hmac-sha256'
      );

      expect(result).toBe(false);
    });
  });

  describe('circuit breaker', () => {
    it('circuit breaker is closed initially', () => {
      const isOpen = (service as any).isCircuitBreakerOpen('trigger-123');
      expect(isOpen).toBe(false);
    });

    it('opens circuit breaker after threshold failures', () => {
      const triggerId = 'trigger-123';
      const recordFailure = (service as any).recordCircuitBreakerFailure.bind(service);
      const isOpen = (service as any).isCircuitBreakerOpen.bind(service);

      // Threshold is 3 (CIRCUIT_BREAKER_THRESHOLD)
      recordFailure(triggerId);
      recordFailure(triggerId);
      expect(isOpen(triggerId)).toBe(false);

      recordFailure(triggerId); // 3rd failure - threshold reached
      expect(isOpen(triggerId)).toBe(true);
    });

    it('resets circuit breaker', () => {
      const triggerId = 'trigger-123';
      const recordFailure = (service as any).recordCircuitBreakerFailure.bind(service);
      const resetBreaker = (service as any).resetCircuitBreaker.bind(service);
      const isOpen = (service as any).isCircuitBreakerOpen.bind(service);

      // Open the circuit breaker (threshold is 3)
      for (let i = 0; i < 3; i++) {
        recordFailure(triggerId);
      }
      expect(isOpen(triggerId)).toBe(true);

      // Reset it
      resetBreaker(triggerId);
      expect(isOpen(triggerId)).toBe(false);
    });
  });

  describe('start/stop lifecycle', () => {
    it('starts and logs', async () => {
      await service.start();

      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ adapterCount: 0 }),
        'Starting TriggerEvaluatorService'
      );
      expect(mockedLogger.info).toHaveBeenCalledWith('TriggerEvaluatorService started');
    });

    it('warns when already running', async () => {
      await service.start();
      await service.start();

      expect(mockedLogger.warn).toHaveBeenCalledWith('TriggerEvaluator already running');
    });

    it('stops gracefully', async () => {
      await service.start();
      await service.stop();

      expect(mockedLogger.info).toHaveBeenCalledWith('TriggerEvaluatorService stopped');
    });
  });

  describe('hasPendingConfirmation', () => {
    it('returns true when pending confirmations exist', async () => {
      (mockPrisma.trigger_executions.count as jest.Mock).mockResolvedValue(1);

      const result = await service.hasPendingConfirmation('tenant-123', '+1234567890');

      expect(result).toBe(true);
    });

    it('returns false when no pending confirmations', async () => {
      (mockPrisma.trigger_executions.count as jest.Mock).mockResolvedValue(0);

      const result = await service.hasPendingConfirmation('tenant-123', '+1234567890');

      expect(result).toBe(false);
    });
  });
});
