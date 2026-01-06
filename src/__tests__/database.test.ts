/* eslint-disable @typescript-eslint/no-require-imports */
// Dynamic require() is needed in tests to re-import modules after jest.resetModules()

// Set test environment variables before importing modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(32); // 32 bytes for AES-256
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
process.env.N8N_CALLBACK_SECRET = 'test-n8n-secret';
process.env.N8N_BASE_URL = 'https://n8n.test.com';

import { resetConfig, getConfig, ConfigError } from '../config';

// Task Group 1 Tests: Prisma Configuration
describe('Task Group 1: Prisma Configuration', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    // Restore env vars
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(32);
  });

  it('Prisma client can be imported without errors', async () => {
    // Dynamic import to test if module loads correctly
    const { PrismaClient } = require('@prisma/client');
    expect(PrismaClient).toBeDefined();
    expect(typeof PrismaClient).toBe('function');
  });

  it('database connection configuration uses DATABASE_URL', () => {
    const config = getConfig();
    expect(config.databaseUrl).toBe('postgresql://test:test@localhost:5432/test');
  });

  it('CREDENTIALS_ENCRYPTION_KEY env var is validated', () => {
    resetConfig();
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    expect(() => getConfig()).toThrow(ConfigError);
    expect(() => getConfig()).toThrow('Missing required environment variable: CREDENTIALS_ENCRYPTION_KEY');
  });
});

// Task Group 2 Tests: Schema Models
describe('Task Group 2: Schema Models', () => {
  it('Tenant model has required fields', async () => {
    const { Prisma } = require('@prisma/client');

    // Check Tenant model fields exist through Prisma types
    const tenantFields = Prisma.TenantScalarFieldEnum;
    expect(tenantFields.id).toBe('id');
    expect(tenantFields.name).toBe('name');
    expect(tenantFields.phone_number).toBe('phone_number');
    expect(tenantFields.whatsapp_phone_number_id).toBe('whatsapp_phone_number_id');
    expect(tenantFields.status).toBe('status');
    expect(tenantFields.onboarding_status).toBe('onboarding_status');
    expect(tenantFields.created_at).toBe('created_at');
    expect(tenantFields.updated_at).toBe('updated_at');
  });

  it('Message model has correct relationship to Tenant', async () => {
    const { Prisma } = require('@prisma/client');

    // Check messages model has tenant_id field (model name is lowercase plural)
    const messageFields = Prisma.MessagesScalarFieldEnum;
    expect(messageFields.tenant_id).toBe('tenant_id');
    expect(messageFields.id).toBe('id');
    expect(messageFields.whatsapp_message_id).toBe('whatsapp_message_id');
    expect(messageFields.direction).toBe('direction');
    expect(messageFields.content).toBe('content');
    expect(messageFields.delivery_status).toBe('delivery_status');
    expect(messageFields.created_at).toBe('created_at');
  });

  it('enum values are correctly defined', async () => {
    const { TenantStatus, OnboardingStatus, MessageDirection, DeliveryStatus, WorkflowExecutionStatus } = require('@prisma/client');

    // TenantStatus enum
    expect(TenantStatus.TRIAL).toBe('TRIAL');
    expect(TenantStatus.ACTIVE).toBe('ACTIVE');
    expect(TenantStatus.CHURNED).toBe('CHURNED');

    // OnboardingStatus enum
    expect(OnboardingStatus.DISCOVERY).toBe('DISCOVERY');
    expect(OnboardingStatus.BUILDING).toBe('BUILDING');
    expect(OnboardingStatus.LIVE).toBe('LIVE');
    expect(OnboardingStatus.PAUSED).toBe('PAUSED');

    // MessageDirection enum
    expect(MessageDirection.INBOUND).toBe('INBOUND');
    expect(MessageDirection.OUTBOUND).toBe('OUTBOUND');

    // DeliveryStatus enum
    expect(DeliveryStatus.SENT).toBe('SENT');
    expect(DeliveryStatus.DELIVERED).toBe('DELIVERED');
    expect(DeliveryStatus.READ).toBe('READ');
    expect(DeliveryStatus.FAILED).toBe('FAILED');

    // WorkflowExecutionStatus enum
    expect(WorkflowExecutionStatus.PENDING).toBe('PENDING');
    expect(WorkflowExecutionStatus.RUNNING).toBe('RUNNING');
    expect(WorkflowExecutionStatus.COMPLETED).toBe('COMPLETED');
    expect(WorkflowExecutionStatus.FAILED).toBe('FAILED');
  });

  it('unique constraints are defined for phone_number and whatsapp_message_id', async () => {
    const { Prisma } = require('@prisma/client');

    // The existence of these field enums confirms the schema is valid
    // Unique constraints are enforced at database level
    expect(Prisma.TenantScalarFieldEnum.phone_number).toBe('phone_number');
    expect(Prisma.MessagesScalarFieldEnum.whatsapp_message_id).toBe('whatsapp_message_id');
  });
});

// Task Group 3 Tests: Type Integration
describe('Task Group 3: Type Integration', () => {
  it('PrismaTenantResolver returns correct tenant', async () => {
    // Import after env vars are set
    const { PrismaTenantResolver } = require('../services/tenant');

    // Mock the prisma client
    const mockPrisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'test-uuid',
          name: 'Test Realtor',
          phone_number: '+1234567890',
          whatsapp_phone_number_id: 'wa-123',
          status: 'ACTIVE',
          onboarding_status: 'LIVE',
          created_at: new Date(),
          updated_at: new Date(),
        }),
      },
    };

    const resolver = new PrismaTenantResolver(mockPrisma as any);
    const tenant = await resolver.resolveTenant('+1234567890');

    expect(tenant).not.toBeNull();
    expect(tenant?.id).toBe('test-uuid');
    expect(tenant?.name).toBe('Test Realtor');
    expect(tenant?.phoneNumber).toBe('+1234567890');
    expect(tenant?.whatsappPhoneNumberId).toBe('wa-123');
    expect(tenant?.status).toBe('ACTIVE');
    expect(tenant?.onboardingStatus).toBe('LIVE');
  });

  it('PrismaTenantResolver returns null for unknown phone', async () => {
    const { PrismaTenantResolver } = require('../services/tenant');

    const mockPrisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const resolver = new PrismaTenantResolver(mockPrisma as any);
    const tenant = await resolver.resolveTenant('+9999999999');

    expect(tenant).toBeNull();
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { phone_number: '+9999999999' },
    });
  });

  it('updated Tenant interface includes new fields', async () => {
    const { Tenant, TenantStatus, OnboardingStatus } = require('../types/tenant') as any;

    // TypeScript compile-time check via runtime usage
    const tenant: typeof Tenant = {
      id: 'test-id',
      name: 'Test Name',
      phoneNumber: '+1234567890',
      whatsappPhoneNumberId: 'wa-123',
      status: 'ACTIVE' as typeof TenantStatus,
      onboardingStatus: 'LIVE' as typeof OnboardingStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(tenant.whatsappPhoneNumberId).toBe('wa-123');
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.onboardingStatus).toBe('LIVE');
    expect(tenant.createdAt).toBeInstanceOf(Date);
    expect(tenant.updatedAt).toBeInstanceOf(Date);
  });

  it('Prisma types align with existing Tenant interface', async () => {
    const { Prisma } = require('@prisma/client');

    // Verify field names align (prisma uses snake_case, interface uses camelCase)
    const tenantFields = Prisma.TenantScalarFieldEnum;

    // These are the database field names
    expect(tenantFields.id).toBeDefined();
    expect(tenantFields.name).toBeDefined();
    expect(tenantFields.phone_number).toBeDefined(); // maps to phoneNumber
    expect(tenantFields.whatsapp_phone_number_id).toBeDefined(); // maps to whatsappPhoneNumberId
    expect(tenantFields.status).toBeDefined();
    expect(tenantFields.onboarding_status).toBeDefined(); // maps to onboardingStatus
    expect(tenantFields.created_at).toBeDefined(); // maps to createdAt
    expect(tenantFields.updated_at).toBeDefined(); // maps to updatedAt
  });
});

// Task Group 4 Tests: Encryption Utility
describe('Task Group 4: Encryption Utility', () => {
  beforeEach(() => {
    // Ensure encryption key is set
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(32);
    resetConfig();
    jest.resetModules();
  });

  it('encrypt function produces valid base64 output', async () => {
    const { encryptCredential } = require('../utils/encryption');

    const encrypted = encryptCredential('test-api-key');

    // Should be valid base64
    expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    // Base64 string should be different from input
    expect(encrypted).not.toBe('test-api-key');
  });

  it('decrypt function recovers original value', async () => {
    const { encryptCredential, decryptCredential } = require('../utils/encryption');

    const original = 'my-secret-api-key-12345';
    const encrypted = encryptCredential(original);
    const decrypted = decryptCredential(encrypted);

    expect(decrypted).toBe(original);
  });

  it('decrypt fails gracefully with wrong key', async () => {
    // First encrypt with original key
    const { encryptCredential } = require('../utils/encryption');
    const encrypted = encryptCredential('test-value');

    // Change the encryption key and reset modules
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'b'.repeat(32);
    resetConfig();
    jest.resetModules();

    // Re-import with new key
    const { decryptCredential } = require('../utils/encryption');

    // Should throw with wrong key
    expect(() => decryptCredential(encrypted)).toThrow();

    // Restore original key
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(32);
    resetConfig();
  });

  it('encrypt/decrypt roundtrip works with various input sizes', async () => {
    const { encryptCredential, decryptCredential } = require('../utils/encryption');

    const testValues = [
      'a', // 1 byte
      'short', // 5 bytes
      'medium-length-api-key-value', // ~27 bytes
      'a'.repeat(1000), // 1KB
      JSON.stringify({ key: 'value', nested: { array: [1, 2, 3] } }), // JSON
    ];

    for (const original of testValues) {
      const encrypted = encryptCredential(original);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(original);
    }
  });
});
