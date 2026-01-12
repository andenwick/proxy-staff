import { logger } from '../utils/logger.js';
import { TelegramService } from './messaging/telegram.js';

export type AlertLevel = 'critical' | 'warning' | 'info';
export type AlertCategory = 'tool_failure' | 'session_error' | 'scheduled_task' | 'system' | 'rate_limit';

interface AlertOptions {
  level: AlertLevel;
  category: AlertCategory;
  title: string;
  message: string;
  context?: Record<string, unknown>;
}

// Simple in-memory throttling to prevent alert floods
const alertThrottle = new Map<string, number>();
const THROTTLE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes between same alerts
const MAX_ALERTS_PER_HOUR = 20;
let alertsThisHour = 0;
let hourResetAt = Date.now() + 60 * 60 * 1000;

/**
 * Centralized alerting service for critical errors.
 * Sends alerts via Telegram to ADMIN_TELEGRAM_CHAT_ID.
 */
export class AlertService {
  private telegramService: TelegramService | null = null;

  constructor(telegramService?: TelegramService) {
    this.telegramService = telegramService || null;
  }

  setTelegramService(telegramService: TelegramService): void {
    this.telegramService = telegramService;
  }

  /**
   * Send an alert notification.
   * Includes throttling to prevent alert floods.
   */
  async alert(options: AlertOptions): Promise<void> {
    const { level, category, title, message, context } = options;

    // Log all alerts regardless of sending
    const logFn = level === 'critical' ? logger.error.bind(logger) : logger.warn.bind(logger);
    logFn({ category, title, context }, `[ALERT] ${message}`);

    // Check if we should send this alert
    const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!chatId) {
      logger.debug('ADMIN_TELEGRAM_CHAT_ID not configured, alert logged only');
      return;
    }

    if (!this.telegramService) {
      logger.debug('Telegram service not initialized, alert logged only');
      return;
    }

    // Throttle check
    const throttleKey = `${category}:${title}`;
    const lastAlert = alertThrottle.get(throttleKey);
    if (lastAlert && Date.now() - lastAlert < THROTTLE_WINDOW_MS) {
      logger.debug({ throttleKey }, 'Alert throttled');
      return;
    }

    // Hourly rate limit check
    if (Date.now() > hourResetAt) {
      alertsThisHour = 0;
      hourResetAt = Date.now() + 60 * 60 * 1000;
    }
    if (alertsThisHour >= MAX_ALERTS_PER_HOUR) {
      logger.warn('Hourly alert limit reached, alert dropped');
      return;
    }

    // Update throttle state
    alertThrottle.set(throttleKey, Date.now());
    alertsThisHour++;

    // Format and send
    const emoji = level === 'critical' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
    const formattedMessage = this.formatAlert(emoji, title, message, category, context);

    try {
      await this.telegramService.sendTextMessage(chatId, formattedMessage);
      logger.info({ category, title }, 'Alert sent to Telegram');
    } catch (error) {
      logger.error({ error, category, title }, 'Failed to send Telegram alert');
    }
  }

  private formatAlert(
    emoji: string,
    title: string,
    message: string,
    category: AlertCategory,
    context?: Record<string, unknown>
  ): string {
    const lines = [
      `${emoji} <b>${title}</b>`,
      '',
      message,
    ];

    if (context && Object.keys(context).length > 0) {
      lines.push('');
      for (const [key, value] of Object.entries(context)) {
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        // Truncate long values
        const truncated = displayValue.length > 200
          ? displayValue.substring(0, 200) + '...'
          : displayValue;
        lines.push(`<b>${key}:</b> ${truncated}`);
      }
    }

    lines.push('', `<i>Category: ${category}</i>`);

    return lines.join('\n');
  }

  // Convenience methods for common alert types

  async criticalError(title: string, message: string, context?: Record<string, unknown>): Promise<void> {
    return this.alert({ level: 'critical', category: 'system', title, message, context });
  }

  async toolFailure(toolName: string, tenantId: string, error: string): Promise<void> {
    return this.alert({
      level: 'warning',
      category: 'tool_failure',
      title: 'Tool Failure',
      message: `Tool "${toolName}" failed for tenant "${tenantId}"`,
      context: { error: error.substring(0, 500) },
    });
  }

  async sessionError(tenantId: string, error: string): Promise<void> {
    return this.alert({
      level: 'warning',
      category: 'session_error',
      title: 'Session Error',
      message: `Session error for tenant "${tenantId}"`,
      context: { error: error.substring(0, 500) },
    });
  }

  async scheduledTaskFailure(taskId: string, tenantId: string, error: string): Promise<void> {
    return this.alert({
      level: 'warning',
      category: 'scheduled_task',
      title: 'Scheduled Task Failed',
      message: `Scheduled task "${taskId}" failed`,
      context: { tenantId, error: error.substring(0, 500) },
    });
  }

  async rateLimitExceeded(identifier: string): Promise<void> {
    return this.alert({
      level: 'info',
      category: 'rate_limit',
      title: 'Rate Limit Exceeded',
      message: `Rate limit exceeded for ${identifier}`,
      context: { identifier },
    });
  }
}

// Singleton instance
let alertService: AlertService | null = null;

export function getAlertService(): AlertService {
  if (!alertService) {
    alertService = new AlertService();
  }
  return alertService;
}

export function initAlertService(telegramService: TelegramService): AlertService {
  if (!alertService) {
    alertService = new AlertService(telegramService);
  } else {
    alertService.setTelegramService(telegramService);
  }
  return alertService;
}
