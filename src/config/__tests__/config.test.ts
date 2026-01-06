import { loadConfig, ConfigError } from '../index';

describe('Config Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const setRequiredEnvVars = () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-ok';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';
  };

  it('loads config successfully with all required env vars present', () => {
    setRequiredEnvVars();

    const config = loadConfig();

    expect(config.nodeEnv).toBe('development');
    expect(config.databaseUrl).toBe('postgresql://user:pass@localhost:5432/test');
    expect(config.credentialsEncryptionKey).toBe('test-encryption-key-32-bytes-ok');
    expect(config.whatsapp.verifyToken).toBe('test-verify-token');
    expect(config.whatsapp.appSecret).toBe('test-app-secret');
    expect(config.whatsapp.accessToken).toBe('test-access-token');
    expect(config.whatsapp.phoneNumberId).toBe('123456789');
  });

  it('throws ConfigError when required env var is missing', () => {
    setRequiredEnvVars();
    delete process.env.WHATSAPP_APP_SECRET;

    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow('Missing required environment variable: WHATSAPP_APP_SECRET');
  });

  it('uses default values for PORT and LOG_LEVEL when not provided', () => {
    setRequiredEnvVars();
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;

    const config = loadConfig();

    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('respects custom PORT and LOG_LEVEL values', () => {
    setRequiredEnvVars();
    process.env.PORT = '8080';
    process.env.LOG_LEVEL = 'debug';

    const config = loadConfig();

    expect(config.port).toBe(8080);
    expect(config.logLevel).toBe('debug');
  });
});
