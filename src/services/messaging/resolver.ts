import type { PrismaClient } from '@prisma/client';
import type { MessagingService } from './types.js';
import type { WhatsAppService } from '../whatsapp.js';
import type { TelegramService } from './telegram.js';
import { logger } from '../../utils/logger.js';

export class MessagingServiceResolver {
  private prisma: PrismaClient;
  private whatsappService: WhatsAppService;
  private telegramService: TelegramService | null;

  constructor(
    prisma: PrismaClient,
    whatsappService: WhatsAppService,
    telegramService: TelegramService | null
  ) {
    this.prisma = prisma;
    this.whatsappService = whatsappService;
    this.telegramService = telegramService;
  }

  /**
   * Get the messaging service for a tenant based on their configured channel
   */
  async resolveForTenant(tenantId: string): Promise<MessagingService> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messaging_channel: true },
    });

    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    if (tenant.messaging_channel === 'TELEGRAM') {
      if (!this.telegramService) {
        throw new Error('Telegram service not configured');
      }
      return this.telegramService;
    }

    // Default to WhatsApp
    return this.whatsappService;
  }

  /**
   * Get the recipient identifier for sending messages to a tenant's user
   * For WhatsApp: phone number
   * For Telegram: chat_id
   */
  async getRecipientId(tenantId: string, fallbackPhone: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        messaging_channel: true,
        telegram_chat_id: true,
      },
    });

    if (!tenant) {
      logger.warn({ tenantId }, 'Tenant not found, using fallback phone');
      return fallbackPhone;
    }

    if (tenant.messaging_channel === 'TELEGRAM') {
      if (!tenant.telegram_chat_id) {
        throw new Error(`Tenant ${tenantId} has no Telegram chat linked`);
      }
      return tenant.telegram_chat_id;
    }

    return fallbackPhone;
  }

  /**
   * Check if a tenant is using Telegram
   */
  async isTelegramTenant(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messaging_channel: true },
    });

    return tenant?.messaging_channel === 'TELEGRAM';
  }
}
