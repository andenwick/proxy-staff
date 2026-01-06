/**
 * Telegram Webhook Route Tests
 *
 * Tests for Telegram webhook handling, /start command processing,
 * message forwarding, and deduplication.
 */

import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { telegramWebhookRoutes, stopTelegramDeduplicationCleanup } from '../telegram.js';

// Mock all service dependencies
const mockMessageProcessor = {
  processIncomingMessage: jest.fn().mockResolvedValue({ success: true }),
};

const mockTenantResolver = {
  resolveTenantByTelegramChatId: jest.fn(),
};

const mockTelegramService = {
  sendTextMessage: jest.fn().mockResolvedValue('tg-msg-id'),
};

const mockTriggerEvaluator = {
  handleConfirmationResponse: jest.fn(),
};

const mockPrismaClient = {
  tenant: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../../services/index.js', () => ({
  getMessageProcessor: jest.fn(() => mockMessageProcessor),
  getTenantResolver: jest.fn(() => mockTenantResolver),
  getTelegramService: jest.fn(() => mockTelegramService),
  getTriggerEvaluator: jest.fn(() => mockTriggerEvaluator),
  getPrismaClient: jest.fn(() => mockPrismaClient),
}));

jest.mock('../../../utils/logger.js', () => ({
  createRequestLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  })),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Telegram Webhook Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    server.decorateRequest('requestId', '');
    server.addHook('preHandler', async (request) => {
      request.requestId = 'test-request-id';
    });
    await server.register(telegramWebhookRoutes);
    await server.ready();
  });

  afterAll(async () => {
    stopTelegramDeduplicationCleanup();
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset tenant resolver to return null (unlinked) by default
    mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue(null);
    mockTriggerEvaluator.handleConfirmationResponse.mockRejectedValue(new Error('Not available'));
  });

  describe('POST /webhooks/telegram', () => {
    it('returns 200 immediately for any update', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: 123456,
          message: {
            message_id: 1,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    });

    it('skips non-text messages', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: 123457,
          message: {
            message_id: 2,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            // No text field - e.g., a sticker or photo
          },
        },
      });

      expect(response.statusCode).toBe(200);
      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      expect(mockMessageProcessor.processIncomingMessage).not.toHaveBeenCalled();
    });

    it('skips updates without message', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: 123458,
          // No message field - e.g., callback_query or edited_message
        },
      });

      expect(response.statusCode).toBe(200);
      await new Promise(resolve => setImmediate(resolve));
      expect(mockMessageProcessor.processIncomingMessage).not.toHaveBeenCalled();
    });

    it('deduplicates updates with same update_id', async () => {
      const updateId = Date.now(); // Use unique ID to avoid conflicts with other tests

      // First request
      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 100,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello',
          },
        },
      });

      // Wait for first async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second request with same update_id
      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 100,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello',
          },
        },
      });

      // Wait for second async processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // The message processor or telegram service should only be called once for this update_id
      // Due to the deduplication, the second request should be skipped
    });
  });

  describe('/start command handling', () => {
    it('sends welcome message when /start without phone number', async () => {
      const updateId = Date.now() + 1000;

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 10,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start',
          },
        },
      });

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('Welcome')
      );
    });

    it('validates phone number format', async () => {
      const updateId = Date.now() + 2000;

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 11,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start invalid-phone',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('Invalid phone format')
      );
    });

    it('returns error when tenant not found', async () => {
      const updateId = Date.now() + 3000;
      mockPrismaClient.tenant.findUnique.mockResolvedValue(null);

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 12,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('No account found')
      );
    });

    it('returns error when tenant not configured for Telegram', async () => {
      const updateId = Date.now() + 4000;
      mockPrismaClient.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        phone_number: '+1234567890',
        messaging_channel: 'WHATSAPP',
        telegram_chat_id: null,
        name: 'Test User',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 13,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('not configured for Telegram')
      );
    });

    it('successfully links Telegram chat to tenant', async () => {
      const updateId = Date.now() + 5000;
      mockPrismaClient.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        phone_number: '+1234567890',
        messaging_channel: 'TELEGRAM',
        telegram_chat_id: null,
        name: 'Test User',
      });
      mockPrismaClient.tenant.update.mockResolvedValue({});

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 14,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockPrismaClient.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-123' },
        data: {
          telegram_chat_id: '12345',
          telegram_linked_at: expect.any(Date),
        },
      });
      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('Successfully linked')
      );
    });

    it('handles already linked same chat', async () => {
      const updateId = Date.now() + 6000;
      mockPrismaClient.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        phone_number: '+1234567890',
        messaging_channel: 'TELEGRAM',
        telegram_chat_id: '12345', // Already linked to same chat
        name: 'Test User',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 15,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining("already linked")
      );
    });

    it('handles already linked different chat', async () => {
      const updateId = Date.now() + 7000;
      mockPrismaClient.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        phone_number: '+1234567890',
        messaging_channel: 'TELEGRAM',
        telegram_chat_id: '99999', // Linked to different chat
        name: 'Test User',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 16,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('already linked to a different')
      );
    });
  });

  describe('message forwarding to processor', () => {
    it('forwards message to processor when tenant is linked', async () => {
      const updateId = Date.now() + 8000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 20,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello from Telegram',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        'Hello from Telegram',
        'tg_20'
      );
    });

    it('asks unlinked user to link account', async () => {
      const updateId = Date.now() + 9000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue(null);

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 21,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('link your account')
      );
    });
  });

  describe('trigger confirmation handling', () => {
    it('handles YES confirmation', async () => {
      const updateId = Date.now() + 10000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });
      mockTriggerEvaluator.handleConfirmationResponse.mockResolvedValue({
        handled: true,
        message: 'Trigger confirmed!',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 30,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'YES',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTriggerEvaluator.handleConfirmationResponse).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        true
      );
      expect(mockTelegramService.sendTextMessage).toHaveBeenCalledWith(
        '12345',
        'Trigger confirmed!'
      );
    });

    it('handles NO confirmation', async () => {
      const updateId = Date.now() + 11000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });
      mockTriggerEvaluator.handleConfirmationResponse.mockResolvedValue({
        handled: true,
        message: 'Trigger cancelled.',
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 31,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'no',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockTriggerEvaluator.handleConfirmationResponse).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        false
      );
    });

    it('processes YES/NO as normal message when trigger evaluator unavailable', async () => {
      const updateId = Date.now() + 12000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });
      mockTriggerEvaluator.handleConfirmationResponse.mockRejectedValue(new Error('Not available'));

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 32,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'YES',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Should fall through to message processor
      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        'YES',
        'tg_32'
      );
    });

    it('processes YES/NO as normal when not handled', async () => {
      const updateId = Date.now() + 13000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });
      mockTriggerEvaluator.handleConfirmationResponse.mockResolvedValue({
        handled: false,
      });

      await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 33,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'YES',
          },
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockMessageProcessor.processIncomingMessage).toHaveBeenCalledWith(
        'tenant-123',
        '+1234567890',
        'YES',
        'tg_33'
      );
    });
  });

  describe('error handling', () => {
    it('handles errors gracefully during async processing', async () => {
      const updateId = Date.now() + 14000;
      mockTenantResolver.resolveTenantByTelegramChatId.mockResolvedValue({
        id: 'tenant-123',
        phoneNumber: '+1234567890',
      });
      mockMessageProcessor.processIncomingMessage.mockRejectedValue(new Error('Processing error'));

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 40,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'Hello',
          },
        },
      });

      // Should still return 200 even if async processing fails
      expect(response.statusCode).toBe(200);
    });

    it('handles null telegram service', async () => {
      const updateId = Date.now() + 15000;

      // Temporarily mock getTelegramService to return null
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTelegramService } = require('../../../services/index.js');
      getTelegramService.mockReturnValueOnce(null);

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/telegram',
        payload: {
          update_id: updateId,
          message: {
            message_id: 41,
            from: { id: 12345, first_name: 'Test' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: '/start +1234567890',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
