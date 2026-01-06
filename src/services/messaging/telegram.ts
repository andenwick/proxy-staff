import { logger } from '../../utils/logger.js';
import { fetchWithRetry, HttpError } from '../../utils/http.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import type { MessagingService } from './types.js';

export interface TelegramConfig {
  botToken: string;
}

interface TelegramSendMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
    text: string;
  };
  description?: string;
  error_code?: number;
}

export class TelegramService implements MessagingService {
  readonly channel = 'telegram' as const;
  private config: TelegramConfig;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  /**
   * Send a text message via Telegram Bot API.
   * Returns the Telegram message ID on success.
   */
  async sendTextMessage(chatId: string, text: string): Promise<string> {
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    };

    const startMs = Date.now();

    try {
      const response = await fetchWithRetry(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          timeoutMs: 10000,
          retries: 2,
          retryDelayMs: 500,
          onRetry: (attempt, err) => {
            logger.warn({ chatId, attempt, error: err.message }, 'Retrying Telegram API request');
          },
        }
      );

      const data = await response.json() as TelegramSendMessageResponse;

      if (!data.ok || !data.result) {
        throw new Error(data.description || 'Unknown Telegram API error');
      }

      const messageId = String(data.result.message_id);

      recordTiming('telegram_request_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('telegram_requests', { status: 'ok' });
      logger.info({ chatId, messageId }, 'Telegram message sent');
      return messageId;
    } catch (error) {
      const err = error as Error;
      recordTiming('telegram_request_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('telegram_requests', { status: 'error' });

      if (err instanceof HttpError) {
        logger.error({ chatId, status: err.status, error: err.body }, 'Telegram API error');
      } else {
        logger.error({ chatId, error: err }, 'Failed to send Telegram message');
      }

      throw err;
    }
  }
}
