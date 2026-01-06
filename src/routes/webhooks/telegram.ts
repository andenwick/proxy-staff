import { FastifyPluginAsync } from 'fastify';
import { createRequestLogger } from '../../utils/logger.js';
import { getMessageProcessor, getTenantResolver, getTelegramService, getTriggerEvaluator, getPrismaClient } from '../../services/index.js';

// In-memory deduplication with timestamp-based TTL
const processedUpdateIds = new Map<number, number>();
const UPDATE_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_DEDUP_ENTRIES = 10000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startDeduplicationCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, timestamp] of processedUpdateIds.entries()) {
      if (now - timestamp > UPDATE_DEDUP_TTL_MS) {
        processedUpdateIds.delete(id);
      }
    }
    if (processedUpdateIds.size > MAX_DEDUP_ENTRIES) {
      const entries = Array.from(processedUpdateIds.entries())
        .sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, processedUpdateIds.size - MAX_DEDUP_ENTRIES);
      for (const [id] of toRemove) {
        processedUpdateIds.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopTelegramDeduplicationCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

function markUpdateProcessed(updateId: number): boolean {
  if (!cleanupInterval) {
    startDeduplicationCleanup();
  }

  const existingTimestamp = processedUpdateIds.get(updateId);
  if (existingTimestamp !== undefined) {
    if (Date.now() - existingTimestamp < UPDATE_DEDUP_TTL_MS) {
      return false;
    }
  }

  processedUpdateIds.set(updateId, Date.now());
  return true;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    date: number;
    text?: string;
  };
}

export const telegramWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /webhooks/telegram - Incoming message endpoint
   * Receives updates from Telegram Bot API
   */
  fastify.post<{ Body: TelegramUpdate }>(
    '/webhooks/telegram',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const update = request.body;

      logger.info({
        updateId: update.update_id,
        hasMessage: !!update.message,
      }, 'Received Telegram webhook');

      // Return 200 immediately (Telegram requires fast response)
      reply.status(200).send({ ok: true });

      // Process message asynchronously
      setImmediate(async () => {
        try {
          // Deduplicate
          if (!markUpdateProcessed(update.update_id)) {
            logger.info({ updateId: update.update_id }, 'Skipping duplicate update');
            return;
          }

          if (!update.message?.text) {
            logger.debug('Non-text message, skipping');
            return;
          }

          const chatId = String(update.message.chat.id);
          const messageId = String(update.message.message_id);
          const text = update.message.text;

          const telegramService = getTelegramService();
          if (!telegramService) {
            logger.error('Telegram service not configured');
            return;
          }

          // Handle /start command for linking
          if (text.startsWith('/start')) {
            await handleStartCommand(chatId, text, logger, telegramService);
            return;
          }

          // Resolve tenant by Telegram chat_id
          const tenantResolver = getTenantResolver();
          const tenant = await tenantResolver.resolveTenantByTelegramChatId(chatId);

          if (!tenant) {
            await telegramService.sendTextMessage(
              chatId,
              'Please link your account first. Send: /start YOUR_PHONE_NUMBER (e.g., /start +1234567890)'
            );
            return;
          }

          // Check for trigger confirmation response (YES/NO)
          const normalizedText = text.trim().toUpperCase();
          if (normalizedText === 'YES' || normalizedText === 'NO') {
            try {
              const triggerEvaluator = getTriggerEvaluator();
              const confirmResult = await triggerEvaluator.handleConfirmationResponse(
                tenant.id,
                tenant.phoneNumber,
                normalizedText === 'YES'
              );

              if (confirmResult.handled) {
                if (confirmResult.message) {
                  await telegramService.sendTextMessage(chatId, confirmResult.message);
                }
                logger.info({ messageId, approved: normalizedText === 'YES' }, 'Trigger confirmation processed');
                return;
              }
            } catch (error) {
              logger.debug({ error }, 'Trigger evaluator not available, processing as normal message');
            }
          }

          // Process the message
          const messageProcessor = getMessageProcessor();
          await messageProcessor.processIncomingMessage(
            tenant.id,
            tenant.phoneNumber,
            text,
            `tg_${messageId}`
          );
        } catch (error) {
          logger.error({ error }, 'Error processing Telegram message');
        }
      });
    }
  );
};

async function handleStartCommand(
  chatId: string,
  text: string,
  logger: ReturnType<typeof createRequestLogger>,
  telegramService: NonNullable<ReturnType<typeof getTelegramService>>
): Promise<void> {
  // Parse phone number from /start +1234567890
  const parts = text.split(/\s+/);
  const phoneNumber = parts[1]?.trim();

  if (!phoneNumber) {
    await telegramService.sendTextMessage(
      chatId,
      'Welcome! To link your account, send: /start YOUR_PHONE_NUMBER\n\nExample: /start +1234567890'
    );
    return;
  }

  // Validate phone format (basic)
  if (!phoneNumber.match(/^\+?[0-9]{10,15}$/)) {
    await telegramService.sendTextMessage(
      chatId,
      'Invalid phone format. Please use international format.\n\nExample: /start +1234567890'
    );
    return;
  }

  const prisma = getPrismaClient();

  // Find tenant by phone number
  const tenant = await prisma.tenant.findUnique({
    where: { phone_number: phoneNumber },
  });

  if (!tenant) {
    await telegramService.sendTextMessage(
      chatId,
      'No account found for this phone number. Please check the number and try again.'
    );
    return;
  }

  if (tenant.messaging_channel !== 'TELEGRAM') {
    await telegramService.sendTextMessage(
      chatId,
      'This account is not configured for Telegram. Please contact support to switch channels.'
    );
    return;
  }

  // Check if already linked
  if (tenant.telegram_chat_id) {
    if (tenant.telegram_chat_id === chatId) {
      await telegramService.sendTextMessage(
        chatId,
        `You're already linked! You can send me messages now, ${tenant.name}.`
      );
    } else {
      await telegramService.sendTextMessage(
        chatId,
        'This account is already linked to a different Telegram chat. Please contact support.'
      );
    }
    return;
  }

  // Link the chat_id to the tenant
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      telegram_chat_id: chatId,
      telegram_linked_at: new Date(),
    },
  });

  await telegramService.sendTextMessage(
    chatId,
    `Successfully linked! Welcome ${tenant.name}. You can now send me messages here.`
  );

  logger.info({ tenantId: tenant.id, chatId }, 'Telegram chat linked to tenant');
}
