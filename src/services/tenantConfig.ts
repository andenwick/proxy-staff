import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

export interface TenantConfigData {
  systemPrompt: string;
  maxHistoryMessages: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Be concise and helpful in your responses.`;

export class TenantConfigService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get tenant configuration. Returns defaults if no config exists.
   */
  async getTenantConfig(tenantId: string): Promise<TenantConfigData> {
    const config = await this.prisma.tenant_configs.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!config) {
      logger.info({ tenantId }, 'No config found for tenant, using defaults');
      return {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        maxHistoryMessages: 20,
      };
    }

    return {
      systemPrompt: config.system_prompt,
      maxHistoryMessages: config.max_history_messages,
    };
  }

  /**
   * Create or update tenant configuration.
   */
  async upsertTenantConfig(
    tenantId: string,
    data: Partial<TenantConfigData>
  ): Promise<TenantConfigData> {
    const config = await this.prisma.tenant_configs.upsert({
      where: { tenant_id: tenantId },
      update: {
        ...(data.systemPrompt && { system_prompt: data.systemPrompt }),
        ...(data.maxHistoryMessages !== undefined && {
          max_history_messages: data.maxHistoryMessages,
        }),
      },
      create: {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        system_prompt: data.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
        max_history_messages: data.maxHistoryMessages ?? 20,
        updated_at: new Date(),
      },
    });

    return {
      systemPrompt: config.system_prompt,
      maxHistoryMessages: config.max_history_messages,
    };
  }
}
