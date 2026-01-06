import { logger } from '../utils/logger.js';
import { fetchWithRetry, HttpError } from '../utils/http.js';
import { incrementCounter, recordTiming } from '../utils/metrics.js';
import type { MessagingService } from './messaging/types.js';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

export class WhatsAppService implements MessagingService {
  readonly channel = 'whatsapp' as const;
  private config: WhatsAppConfig;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  /**
   * Send a text message via WhatsApp Cloud API.
   * Returns the WhatsApp message ID on success.
   */
  async sendTextMessage(to: string, text: string): Promise<string> {
    const url = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    const startMs = Date.now();

    try {
      const response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          timeoutMs: 10000,
          retries: 2,
          retryDelayMs: 500,
          onRetry: (attempt, err) => {
            logger.warn({ to, attempt, error: err.message }, 'Retrying WhatsApp API request');
          },
        }
      );

      const data = await response.json() as { messages: Array<{ id: string }> };
      const messageId = data.messages[0].id;

      recordTiming('whatsapp_request_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('whatsapp_requests', { status: 'ok' });
      logger.info({ to, messageId }, 'WhatsApp message sent');
      return messageId;
    } catch (error) {
      const err = error as Error;
      recordTiming('whatsapp_request_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('whatsapp_requests', { status: 'error' });

      if (err instanceof HttpError) {
        logger.error({ to, status: err.status, error: err.body }, 'WhatsApp API error');
      } else {
        logger.error({ to, error: err }, 'Failed to send WhatsApp message');
      }

      throw err;
    }
  }

  /**
   * Send a template message via WhatsApp Cloud API.
   * Required for proactive outbound messages outside the 24-hour window.
   * Templates must be pre-approved in Meta Business Manager.
   * Returns the WhatsApp message ID on success.
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string = 'en',
    components?: Array<{
      type: 'header' | 'body' | 'button';
      parameters?: Array<{ type: 'text' | 'image' | 'document'; text?: string; image?: { link: string }; document?: { link: string } }>;
      sub_type?: 'quick_reply' | 'url';
      index?: number;
    }>
  ): Promise<string> {
    const url = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`;

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
      },
    };

    // Add components if provided
    if (components && components.length > 0) {
      (body.template as Record<string, unknown>).components = components;
    }

    const startMs = Date.now();

    try {
      const response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          timeoutMs: 10000,
          retries: 2,
          retryDelayMs: 500,
          onRetry: (attempt, err) => {
            logger.warn({ to, templateName, attempt, error: err.message }, 'Retrying WhatsApp template API request');
          },
        }
      );

      const data = await response.json() as { messages: Array<{ id: string }> };
      const messageId = data.messages[0].id;

      recordTiming('whatsapp_request_ms', Date.now() - startMs, { status: 'ok', type: 'template' });
      incrementCounter('whatsapp_requests', { status: 'ok', type: 'template' });
      logger.info({ to, templateName, messageId }, 'WhatsApp template message sent');
      return messageId;
    } catch (error) {
      const err = error as Error;
      recordTiming('whatsapp_request_ms', Date.now() - startMs, { status: 'error', type: 'template' });
      incrementCounter('whatsapp_requests', { status: 'error', type: 'template' });

      if (err instanceof HttpError) {
        logger.error({ to, templateName, status: err.status, error: err.body }, 'WhatsApp template API error');
      } else {
        logger.error({ to, templateName, error: err }, 'Failed to send WhatsApp template message');
      }

      throw err;
    }
  }
}
