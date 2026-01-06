import { logger } from '../../utils/logger.js';

/**
 * Callback type for sending messages
 */
export type SendMessageFn = (tenantId: string, senderPhone: string, message: string) => Promise<string>;

// Rate limiting: track last update per user
const lastUpdateTime = new Map<string, number>();
const MIN_UPDATE_INTERVAL_MS = 60000; // 1 minute between updates

/**
 * Get progress message based on elapsed time
 * Honest time-based messages - no fake guesses
 */
export function getProgressMessage(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60000);

  if (minutes === 0) {
    return '⏳ Working on it...';
  }
  if (minutes === 1) {
    return '⏳ Still working... (1 min)';
  }
  if (minutes < 5) {
    return `⏳ Still working... (${minutes} min)`;
  }
  // After 5 minutes, remind user they can cancel
  return `⏳ Taking a while... (${minutes} min). Send any message to cancel.`;
}

/**
 * Check if we should send a progress update (rate limiting)
 */
export function shouldSendUpdate(tenantId: string, senderPhone: string): boolean {
  const key = `${tenantId}:${senderPhone}`;
  const now = Date.now();
  const lastUpdate = lastUpdateTime.get(key);

  if (!lastUpdate || (now - lastUpdate) >= MIN_UPDATE_INTERVAL_MS) {
    return true;
  }

  return false;
}

/**
 * Record that we sent an update
 */
export function recordUpdateSent(tenantId: string, senderPhone: string): void {
  const key = `${tenantId}:${senderPhone}`;
  lastUpdateTime.set(key, Date.now());
}

/**
 * Clear update tracking for a user
 */
export function clearUpdateTracking(tenantId: string, senderPhone: string): void {
  const key = `${tenantId}:${senderPhone}`;
  lastUpdateTime.delete(key);
}

/**
 * Send a progress update to the user (with rate limiting)
 */
export async function sendProgressUpdate(
  tenantId: string,
  senderPhone: string,
  elapsedMs: number,
  sendMessage: SendMessageFn
): Promise<boolean> {
  // Check rate limiting
  if (!shouldSendUpdate(tenantId, senderPhone)) {
    logger.debug(
      { tenantId, senderPhone: senderPhone.slice(-4), elapsedMs },
      'Skipping progress update (rate limited)'
    );
    return false;
  }

  const message = getProgressMessage(elapsedMs);

  try {
    await sendMessage(tenantId, senderPhone, message);
    recordUpdateSent(tenantId, senderPhone);
    logger.info(
      { tenantId, senderPhone: senderPhone.slice(-4), elapsedMs, message },
      'Sent progress update'
    );
    return true;
  } catch (error) {
    logger.warn(
      { tenantId, senderPhone: senderPhone.slice(-4), error },
      'Failed to send progress update'
    );
    return false;
  }
}

/**
 * ProgressMessenger class for more complex usage
 */
export class ProgressMessenger {
  private sendMessage: SendMessageFn;

  constructor(sendMessage: SendMessageFn) {
    this.sendMessage = sendMessage;
  }

  async send(tenantId: string, senderPhone: string, elapsedMs: number): Promise<boolean> {
    return sendProgressUpdate(tenantId, senderPhone, elapsedMs, this.sendMessage);
  }

  clear(tenantId: string, senderPhone: string): void {
    clearUpdateTracking(tenantId, senderPhone);
  }
}
