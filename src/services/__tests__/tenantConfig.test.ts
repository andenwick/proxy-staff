/**
 * TenantConfigService Tests
 */

import { TenantConfigService } from '../tenantConfig.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('TenantConfigService', () => {
  let mockPrisma: any;
  let service: TenantConfigService;

  beforeEach(() => {
    mockPrisma = {
      tenant_configs: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new TenantConfigService(mockPrisma);
  });

  describe('getTenantConfig', () => {
    it('returns existing config when found', async () => {
      mockPrisma.tenant_configs.findUnique.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'You are a helpful assistant for realtors.',
        max_history_messages: 30,
      });

      const config = await service.getTenantConfig('tenant-1');

      expect(config).toEqual({
        systemPrompt: 'You are a helpful assistant for realtors.',
        maxHistoryMessages: 30,
      });
      expect(mockPrisma.tenant_configs.findUnique).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
      });
    });

    it('returns default config when not found', async () => {
      mockPrisma.tenant_configs.findUnique.mockResolvedValue(null);

      const config = await service.getTenantConfig('new-tenant');

      expect(config).toEqual({
        systemPrompt: 'You are a helpful AI assistant. Be concise and helpful in your responses.',
        maxHistoryMessages: 20,
      });
    });
  });

  describe('upsertTenantConfig', () => {
    it('creates new config with provided values', async () => {
      mockPrisma.tenant_configs.upsert.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'Custom prompt',
        max_history_messages: 50,
      });

      const config = await service.upsertTenantConfig('tenant-1', {
        systemPrompt: 'Custom prompt',
        maxHistoryMessages: 50,
      });

      expect(config).toEqual({
        systemPrompt: 'Custom prompt',
        maxHistoryMessages: 50,
      });
    });

    it('updates only provided fields', async () => {
      mockPrisma.tenant_configs.upsert.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'Updated prompt',
        max_history_messages: 20,
      });

      await service.upsertTenantConfig('tenant-1', {
        systemPrompt: 'Updated prompt',
      });

      expect(mockPrisma.tenant_configs.upsert).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        update: {
          system_prompt: 'Updated prompt',
        },
        create: expect.objectContaining({
          tenant_id: 'tenant-1',
          system_prompt: 'Updated prompt',
        }),
      });
    });

    it('uses defaults for missing fields in create', async () => {
      mockPrisma.tenant_configs.upsert.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'You are a helpful AI assistant. Be concise and helpful in your responses.',
        max_history_messages: 20,
      });

      await service.upsertTenantConfig('tenant-1', {});

      expect(mockPrisma.tenant_configs.upsert).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        update: {},
        create: expect.objectContaining({
          max_history_messages: 20,
        }),
      });
    });

    it('handles maxHistoryMessages of 0', async () => {
      mockPrisma.tenant_configs.upsert.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'prompt',
        max_history_messages: 0,
      });

      await service.upsertTenantConfig('tenant-1', {
        maxHistoryMessages: 0,
      });

      expect(mockPrisma.tenant_configs.upsert).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1' },
        update: {
          max_history_messages: 0,
        },
        create: expect.objectContaining({
          max_history_messages: 0,
        }),
      });
    });

    it('generates UUID for new config', async () => {
      mockPrisma.tenant_configs.upsert.mockResolvedValue({
        tenant_id: 'tenant-1',
        system_prompt: 'prompt',
        max_history_messages: 20,
      });

      await service.upsertTenantConfig('tenant-1', { systemPrompt: 'test' });

      expect(mockPrisma.tenant_configs.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            id: expect.any(String),
          }),
        })
      );
    });
  });
});
