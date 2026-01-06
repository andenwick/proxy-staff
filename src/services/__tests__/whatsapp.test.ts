/**
 * WhatsAppService Tests
 */

import { WhatsAppService } from '../whatsapp.js';
import { HttpError } from '../../utils/http.js';

// Mock dependencies
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../utils/metrics.js', () => ({
  incrementCounter: jest.fn(),
  recordTiming: jest.fn(),
}));

// Mock fetchWithRetry
const mockFetchWithRetry = jest.fn();
jest.mock('../../utils/http.js', () => ({
  fetchWithRetry: (...args: unknown[]) => mockFetchWithRetry(...args),
  HttpError: class HttpError extends Error {
    constructor(public status: number, public body: string) {
      super(`HTTP ${status}`);
    }
  },
}));

import { incrementCounter, recordTiming } from '../../utils/metrics.js';

describe('WhatsAppService', () => {
  let service: WhatsAppService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsAppService({
      accessToken: 'test-token',
      phoneNumberId: '123456789',
    });
  });

  describe('sendTextMessage', () => {
    it('sends text message successfully', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });

      const messageId = await service.sendTextMessage('+1234567890', 'Hello!');

      expect(messageId).toBe('wamid.123');
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/123456789/messages',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '+1234567890',
            type: 'text',
            text: {
              preview_url: false,
              body: 'Hello!',
            },
          }),
        },
        expect.objectContaining({
          timeoutMs: 10000,
          retries: 2,
          retryDelayMs: 500,
        })
      );
    });

    it('records success metrics', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });

      await service.sendTextMessage('+1234567890', 'Test');

      expect(recordTiming).toHaveBeenCalledWith(
        'whatsapp_request_ms',
        expect.any(Number),
        { status: 'ok' }
      );
      expect(incrementCounter).toHaveBeenCalledWith(
        'whatsapp_requests',
        { status: 'ok' }
      );
    });

    it('records error metrics on failure', async () => {
      mockFetchWithRetry.mockRejectedValue(new Error('Network error'));

      await expect(service.sendTextMessage('+1234567890', 'Test'))
        .rejects.toThrow('Network error');

      expect(recordTiming).toHaveBeenCalledWith(
        'whatsapp_request_ms',
        expect.any(Number),
        { status: 'error' }
      );
      expect(incrementCounter).toHaveBeenCalledWith(
        'whatsapp_requests',
        { status: 'error' }
      );
    });

    it('handles HttpError specifically', async () => {
      const httpError = new HttpError(400, '{"error":"Invalid phone"}');
      mockFetchWithRetry.mockRejectedValue(httpError);

      await expect(service.sendTextMessage('+invalid', 'Test'))
        .rejects.toThrow();

      // Error is logged but re-thrown
    });
  });

  describe('sendTemplateMessage', () => {
    it('sends template message without components', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.456' }] }),
      });

      const messageId = await service.sendTemplateMessage(
        '+1234567890',
        'hello_world',
        'en'
      );

      expect(messageId).toBe('wamid.456');
      expect(mockFetchWithRetry).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/123456789/messages',
        expect.objectContaining({
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: '+1234567890',
            type: 'template',
            template: {
              name: 'hello_world',
              language: { code: 'en' },
            },
          }),
        }),
        expect.any(Object)
      );
    });

    it('sends template message with components', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.789' }] }),
      });

      const components = [
        {
          type: 'body' as const,
          parameters: [
            { type: 'text' as const, text: 'John' },
          ],
        },
      ];

      await service.sendTemplateMessage(
        '+1234567890',
        'greeting_template',
        'en',
        components
      );

      const callBody = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
      expect(callBody.template.components).toEqual(components);
    });

    it('defaults language to en', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });

      await service.sendTemplateMessage('+1234567890', 'test_template');

      const callBody = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
      expect(callBody.template.language.code).toBe('en');
    });

    it('records template-specific metrics', async () => {
      mockFetchWithRetry.mockResolvedValue({
        json: () => Promise.resolve({ messages: [{ id: 'wamid.123' }] }),
      });

      await service.sendTemplateMessage('+1234567890', 'test_template');

      expect(recordTiming).toHaveBeenCalledWith(
        'whatsapp_request_ms',
        expect.any(Number),
        { status: 'ok', type: 'template' }
      );
      expect(incrementCounter).toHaveBeenCalledWith(
        'whatsapp_requests',
        { status: 'ok', type: 'template' }
      );
    });

    it('records error metrics for template failures', async () => {
      mockFetchWithRetry.mockRejectedValue(new Error('Template not approved'));

      await expect(service.sendTemplateMessage('+1234567890', 'bad_template'))
        .rejects.toThrow();

      expect(incrementCounter).toHaveBeenCalledWith(
        'whatsapp_requests',
        { status: 'error', type: 'template' }
      );
    });
  });

  describe('channel property', () => {
    it('returns whatsapp', () => {
      expect(service.channel).toBe('whatsapp');
    });
  });
});
