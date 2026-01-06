import { Tenant } from '../types/tenant';
import { PrismaClient } from '@prisma/client';

/**
 * Interface for resolving tenants.
 * Designed for future replacement with database-backed implementation.
 */
export interface TenantResolver {
  resolveTenant(phoneNumber: string): Promise<Tenant | null>;
  resolveTenantByWhatsAppId(whatsappPhoneNumberId: string): Promise<Tenant | null>;
  resolveTenantByTelegramChatId(chatId: string): Promise<Tenant | null>;
}

/**
 * Prisma-based tenant resolver using PostgreSQL database.
 * Production implementation for tenant resolution.
 */
export class PrismaTenantResolver implements TenantResolver {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async resolveTenant(phoneNumber: string): Promise<Tenant | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { phone_number: phoneNumber },
    });

    return this.mapTenant(tenant);
  }

  async resolveTenantByWhatsAppId(whatsappPhoneNumberId: string): Promise<Tenant | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { whatsapp_phone_number_id: whatsappPhoneNumberId },
    });

    return this.mapTenant(tenant);
  }

  async resolveTenantByTelegramChatId(chatId: string): Promise<Tenant | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { telegram_chat_id: chatId },
    });

    return this.mapTenant(tenant);
  }

  private mapTenant(tenant: {
    id: string;
    name: string;
    phone_number: string;
    messaging_channel: string;
    whatsapp_phone_number_id: string | null;
    telegram_chat_id: string | null;
    status: string;
    onboarding_status: string;
    created_at: Date;
    updated_at: Date;
  } | null): Tenant | null {
    if (!tenant) {
      return null;
    }

    return {
      id: tenant.id,
      name: tenant.name,
      phoneNumber: tenant.phone_number,
      messagingChannel: tenant.messaging_channel as Tenant['messagingChannel'],
      whatsappPhoneNumberId: tenant.whatsapp_phone_number_id,
      telegramChatId: tenant.telegram_chat_id,
      status: tenant.status as Tenant['status'],
      onboardingStatus: tenant.onboarding_status as Tenant['onboardingStatus'],
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at,
    };
  }
}

/**
 * In-memory tenant resolver with hardcoded test data.
 * Use this for development and testing.
 */
export class InMemoryTenantResolver implements TenantResolver {
  private tenants: Map<string, Tenant>;

  constructor() {
    this.tenants = new Map();

    const now = new Date();

    // Hardcoded test tenants for development
    this.tenants.set('+1234567890', {
      id: 'tenant-1',
      name: 'Test Realtor',
      phoneNumber: '+1234567890',
      messagingChannel: 'WHATSAPP',
      whatsappPhoneNumberId: 'test-wa-id-1',
      telegramChatId: null,
      status: 'ACTIVE',
      onboardingStatus: 'LIVE',
      createdAt: now,
      updatedAt: now,
    });

    this.tenants.set('+0987654321', {
      id: 'tenant-2',
      name: 'Demo Agent',
      phoneNumber: '+0987654321',
      messagingChannel: 'WHATSAPP',
      whatsappPhoneNumberId: 'test-wa-id-2',
      telegramChatId: null,
      status: 'TRIAL',
      onboardingStatus: 'DISCOVERY',
      createdAt: now,
      updatedAt: now,
    });
  }

  async resolveTenant(phoneNumber: string): Promise<Tenant | null> {
    const tenant = this.tenants.get(phoneNumber);
    return tenant ?? null;
  }

  async resolveTenantByWhatsAppId(whatsappPhoneNumberId: string): Promise<Tenant | null> {
    for (const tenant of this.tenants.values()) {
      if (tenant.whatsappPhoneNumberId === whatsappPhoneNumberId) {
        return tenant;
      }
    }
    return null;
  }

  async resolveTenantByTelegramChatId(chatId: string): Promise<Tenant | null> {
    for (const tenant of this.tenants.values()) {
      if (tenant.telegramChatId === chatId) {
        return tenant;
      }
    }
    return null;
  }
}
