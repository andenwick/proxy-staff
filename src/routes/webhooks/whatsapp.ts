import { FastifyPluginAsync } from 'fastify';
import { getConfig } from '../../config/index.js';
import { createRequestLogger } from '../../utils/logger.js';
import { verifyWhatsAppSignature } from '../../middleware/auth/whatsappSignature.js';
import { WhatsAppWebhookPayload, WhatsAppVerificationQuery } from '../../types/webhook.js';
import { AppError } from '../../middleware/errorHandler.js';
import { getMessageProcessor, getTenantResolver, getWhatsAppService, getTriggerEvaluator } from '../../services/index.js';

// In-memory deduplication with timestamp-based TTL and size limit
const processedMessageIds = new Map<string, number>();
const MESSAGE_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DEDUP_ENTRIES = 10000; // Prevent unbounded growth
const CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

// Periodic cleanup of expired entries (prevents memory leak from setTimeout pattern)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startDeduplicationCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, timestamp] of processedMessageIds.entries()) {
      if (now - timestamp > MESSAGE_DEDUP_TTL_MS) {
        processedMessageIds.delete(id);
      }
    }
    // If still over limit after TTL cleanup, remove oldest entries
    if (processedMessageIds.size > MAX_DEDUP_ENTRIES) {
      const entries = Array.from(processedMessageIds.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp ascending
      const toRemove = entries.slice(0, processedMessageIds.size - MAX_DEDUP_ENTRIES);
      for (const [id] of toRemove) {
        processedMessageIds.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

function stopDeduplicationCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

function markMessageProcessed(messageId: string): boolean {
  // Start cleanup on first use
  if (!cleanupInterval) {
    startDeduplicationCleanup();
  }

  // Check if already processed (and not expired)
  const existingTimestamp = processedMessageIds.get(messageId);
  if (existingTimestamp !== undefined) {
    if (Date.now() - existingTimestamp < MESSAGE_DEDUP_TTL_MS) {
      return false; // Already processed and not expired
    }
    // Expired entry, allow reprocessing
  }

  // Mark as processed with current timestamp
  processedMessageIds.set(messageId, Date.now());
  return true; // New message
}

// Export for graceful shutdown
export { stopDeduplicationCleanup };

interface ExtractedMessage {
  phoneNumberId: string;
  messageId: string;
  senderPhone: string;
  textBody: string;
}

function extractTextMessages(payload: WhatsAppWebhookPayload): ExtractedMessage[] {
  const messages: ExtractedMessage[] = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const { value } = change;
      const phoneNumberId = value.metadata.phone_number_id;

      for (const message of value.messages || []) {
        if (message.type === 'text' && message.text?.body) {
          messages.push({
            phoneNumberId,
            messageId: message.id,
            senderPhone: message.from,
            textBody: message.text.body,
          });
        }
      }
    }
  }

  return messages;
}

export const whatsappWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /webhooks/whatsapp - Webhook verification endpoint
   * Meta sends a GET request with hub.mode, hub.verify_token, and hub.challenge
   * We must return the challenge if the verify_token matches our configured token
   */
  fastify.get<{ Querystring: WhatsAppVerificationQuery }>(
    '/webhooks/whatsapp',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = request.query;

      logger.info({ mode, hasToken: !!token, hasChallenge: !!challenge }, 'WhatsApp webhook verification request');

      // Validate hub.mode is 'subscribe'
      if (mode !== 'subscribe') {
        logger.warn({ mode }, 'Invalid hub.mode');
        throw new AppError('Invalid hub.mode', 'INVALID_MODE', 403);
      }

      // Validate hub.verify_token matches our configured token
      const config = getConfig();
      if (token !== config.whatsapp.verifyToken) {
        logger.warn('Invalid verify_token');
        throw new AppError('Invalid verify_token', 'INVALID_VERIFY_TOKEN', 403);
      }

      // Return the challenge to verify the webhook
      logger.info('WhatsApp webhook verification successful');
      return reply.type('text/plain').send(challenge);
    }
  );

  /**
   * POST /webhooks/whatsapp - Incoming message endpoint
   * Receives incoming messages from Meta's WhatsApp Business API
   * Must validate X-Hub-Signature-256 header using HMAC-SHA256
   */
  fastify.post<{ Body: WhatsAppWebhookPayload }>(
    '/webhooks/whatsapp',
    { preHandler: verifyWhatsAppSignature },
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);

      logger.info({
        object: request.body.object,
        entryCount: request.body.entry?.length || 0,
      }, 'Received WhatsApp webhook');

      // Return 200 immediately (Meta requires fast response)
      reply.status(200).send({ received: true });

      // Process messages asynchronously (after response is sent)
      setImmediate(async () => {
        let currentSenderPhone: string | null = null;

        try {
          const messageProcessor = getMessageProcessor();
          const tenantResolver = getTenantResolver();
          const messages = extractTextMessages(request.body);

          for (const msg of messages) {
            // Deduplicate - skip if already processed
            if (!markMessageProcessed(msg.messageId)) {
              logger.info({ messageId: msg.messageId }, 'Skipping duplicate message');
              continue;
            }

            currentSenderPhone = msg.senderPhone;

            // Resolve tenant by their WhatsApp phone number ID
            const tenant = await tenantResolver.resolveTenantByWhatsAppId(msg.phoneNumberId);
            if (!tenant) {
              logger.warn({ phoneNumberId: msg.phoneNumberId }, 'No tenant found for phone number ID');
              continue;
            }

            // Check for trigger confirmation response (YES/NO)
            const normalizedText = msg.textBody.trim().toUpperCase();
            if (normalizedText === 'YES' || normalizedText === 'NO') {
              try {
                const triggerEvaluator = getTriggerEvaluator();
                const confirmResult = await triggerEvaluator.handleConfirmationResponse(
                  tenant.id,
                  msg.senderPhone,
                  normalizedText === 'YES'
                );

                if (confirmResult.handled) {
                  // Confirmation was processed, send response and skip normal processing
                  if (confirmResult.message) {
                    const whatsappService = getWhatsAppService();
                    await whatsappService.sendTextMessage(msg.senderPhone, confirmResult.message);
                  }
                  logger.info({ messageId: msg.messageId, approved: normalizedText === 'YES' }, 'Trigger confirmation processed');
                  continue;
                }
              } catch (error) {
                logger.debug({ error }, 'Trigger evaluator not available, processing as normal message');
              }
            }

            // Process the message
            await messageProcessor.processIncomingMessage(
              tenant.id,
              msg.senderPhone,
              msg.textBody,
              msg.messageId
            );
          }
        } catch (error) {
          logger.error({ error }, 'Error processing webhook messages');

          // Attempt to notify user of failure
          if (currentSenderPhone) {
            try {
              const whatsappService = getWhatsAppService();
              await whatsappService.sendTextMessage(
                currentSenderPhone,
                'Something went wrong processing your message. Please try again.'
              );
            } catch (notifyError) {
              logger.error({ error: notifyError }, 'Failed to send error notification to user');
            }
          }
        }
      });
    }
  );
};
