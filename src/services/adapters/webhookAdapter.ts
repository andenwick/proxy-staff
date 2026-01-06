import { PrismaClient, TriggerType, TriggerStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { decryptCredential } from '../../utils/encryption.js';
import { extractValue } from '../../utils/objectPath.js';
import type { EventSourceAdapter, TriggerCallback, TriggerEvent, WebhookConfig } from '../../types/trigger.js';
import crypto from 'crypto';

/**
 * WebhookReceiverAdapter - Handles incoming webhooks from external systems.
 *
 * Unlike other adapters that poll, this adapter is invoked directly by the
 * webhook route handler when a POST request is received.
 */
export class WebhookReceiverAdapter implements EventSourceAdapter {
  name = 'webhook';
  private prisma: PrismaClient;
  private callback: TriggerCallback | null = null;
  private idempotencyCache: Map<string, number> = new Map();
  private readonly IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start(): Promise<void> {
    logger.info('WebhookReceiverAdapter started');
    // Clean up old idempotency keys periodically
    setInterval(() => this.cleanupIdempotencyCache(), 60000);
  }

  async stop(): Promise<void> {
    this.idempotencyCache.clear();
    logger.info('WebhookReceiverAdapter stopped');
  }

  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  /**
   * Process an incoming webhook request.
   * Called directly by the webhook route handler.
   */
  async processWebhook(
    webhookPath: string,
    payload: unknown,
    headers: Record<string, string | undefined>
  ): Promise<{ success: boolean; message: string }> {
    // Check idempotency key
    const idempotencyKey = headers['x-idempotency-key'];
    if (idempotencyKey && this.isIdempotencyKeyUsed(idempotencyKey)) {
      logger.debug({ webhookPath, idempotencyKey }, 'Duplicate webhook request (idempotency)');
      return { success: true, message: 'Already processed' };
    }

    // Find trigger by webhook_path
    const trigger = await this.prisma.triggers.findUnique({
      where: { webhook_path: webhookPath },
    });

    if (!trigger) {
      logger.warn({ webhookPath }, 'Webhook trigger not found');
      return { success: false, message: 'Trigger not found' };
    }

    if (trigger.status !== TriggerStatus.ACTIVE) {
      logger.debug({ webhookPath, status: trigger.status }, 'Trigger not active');
      return { success: false, message: 'Trigger not active' };
    }

    // Verify signature if configured
    const config = trigger.config as WebhookConfig;
    if (config.signature_type && config.signature_type !== 'none' && trigger.webhook_secret) {
      const signatureHeader = config.signature_header || 'x-signature';
      const signature = headers[signatureHeader.toLowerCase()];

      if (!signature) {
        logger.warn({ webhookPath }, 'Missing webhook signature');
        return { success: false, message: 'Missing signature' };
      }

      const isValid = this.verifySignature(
        JSON.stringify(payload),
        signature,
        trigger.webhook_secret,
        config.signature_type
      );

      if (!isValid) {
        logger.warn({ webhookPath }, 'Invalid webhook signature');
        return { success: false, message: 'Invalid signature' };
      }
    }

    // Store idempotency key
    if (idempotencyKey) {
      this.idempotencyCache.set(idempotencyKey, Date.now());
    }

    // Extract relevant data from payload if payload_path is configured
    let extractedData = payload;
    if (config.payload_path) {
      extractedData = extractValue(payload, config.payload_path);
    }

    // Create trigger event
    const event: TriggerEvent = {
      triggerId: trigger.id,
      tenantId: trigger.tenant_id,
      userPhone: trigger.user_phone,
      triggerType: TriggerType.WEBHOOK,
      autonomy: trigger.autonomy,
      taskPrompt: trigger.task_prompt,
      payload: {
        source: `webhook:${webhookPath}`,
        data: extractedData,
        metadata: {
          originalPayload: payload,
          headers: this.sanitizeHeaders(headers),
        },
      },
      timestamp: new Date(),
    };

    // Invoke callback asynchronously (don't block webhook response)
    if (this.callback) {
      setImmediate(() => {
        this.callback!(event).catch((error) => {
          logger.error({ webhookPath, error }, 'Error processing webhook trigger');
        });
      });
    }

    return { success: true, message: 'Accepted' };
  }

  /**
   * Verify webhook signature using HMAC.
   */
  private verifySignature(
    payload: string,
    signature: string,
    encryptedSecret: string,
    signatureType: 'hmac-sha256' | 'hmac-sha1'
  ): boolean {
    try {
      const secret = decryptCredential(encryptedSecret);
      const algorithm = signatureType === 'hmac-sha256' ? 'sha256' : 'sha1';

      const expectedSignature = crypto
        .createHmac(algorithm, secret)
        .update(payload)
        .digest('hex');

      // Handle different signature formats (with or without algorithm prefix)
      const normalizedSignature = signature.replace(/^sha256=|^sha1=/, '');

      // Timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(normalizedSignature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error({ error }, 'Error verifying webhook signature');
      return false;
    }
  }

  /**
   * Remove sensitive headers before logging.
   */
  private sanitizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'x-signature', 'x-hub-signature', 'x-hub-signature-256'];

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        sanitized[key] = sensitiveHeaders.includes(key.toLowerCase()) ? '[REDACTED]' : value;
      }
    }

    return sanitized;
  }

  /**
   * Check if idempotency key was already used.
   */
  private isIdempotencyKeyUsed(key: string): boolean {
    return this.idempotencyCache.has(key);
  }

  /**
   * Clean up expired idempotency keys.
   */
  private cleanupIdempotencyCache(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.idempotencyCache.entries()) {
      if (now - timestamp > this.IDEMPOTENCY_TTL_MS) {
        this.idempotencyCache.delete(key);
      }
    }
  }
}
