import dotenv from 'dotenv';

// Load .env file for local development
dotenv.config();

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Config {
  nodeEnv: string;
  port: number;
  logLevel: string;
  databaseUrl: string;
  credentialsEncryptionKey: string;
  tavilyApiKey?: string;
  // Claude CLI configuration
  claudeModel: string;
  // Session management configuration
  sessionTimeoutHours: number;
  // Async task queue configuration
  queue: {
    redisUrl: string;
    workerEnabled: boolean;
    concurrency: number;
    asyncTaskThresholdMs: number;
    progressUpdateIntervalMs: number;
    maxJobRuntimeMs: number;
    maxQueuedJobsPerTenant: number;
  };
  whatsapp: {
    verifyToken: string;
    appSecret: string;
    accessToken: string;
    phoneNumberId: string;
  };
  telegram?: {
    botToken: string;
  };
  gmail?: {
    clientId: string;
    clientSecret: string;
  };
  outlook?: {
    clientId: string;
    clientSecret: string;
  };
}

const requiredEnvVars = [
  'NODE_ENV',
  'DATABASE_URL',
  'CREDENTIALS_ENCRYPTION_KEY',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
] as const;

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  // Validate all required environment variables are present
  for (const envVar of requiredEnvVars) {
    getEnvVar(envVar);
  }

  const config: Config = {
    nodeEnv: getEnvVar('NODE_ENV'),
    port: parseInt(process.env.PORT || '3000', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    databaseUrl: getEnvVar('DATABASE_URL'),
    credentialsEncryptionKey: getEnvVar('CREDENTIALS_ENCRYPTION_KEY'),
    tavilyApiKey: process.env.TAVILY_API_KEY,
    // Claude CLI model: defaults to Opus 4.5
    claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-4-5',
    // Session timeout: defaults to 24 hours if not specified
    sessionTimeoutHours: parseInt(process.env.SESSION_TIMEOUT_HOURS || '24', 10),
    // Async task queue configuration
    queue: {
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      workerEnabled: process.env.WORKER_ENABLED !== 'false',
      concurrency: parseInt(process.env.BULLMQ_CONCURRENCY || '2', 10),
      asyncTaskThresholdMs: parseInt(process.env.ASYNC_TASK_THRESHOLD_MS || '180000', 10), // 3 min
      progressUpdateIntervalMs: parseInt(process.env.PROGRESS_UPDATE_INTERVAL_MS || '60000', 10), // 1 min
      maxJobRuntimeMs: parseInt(process.env.ASYNC_JOB_MAX_RUNTIME_MS || '1200000', 10), // 20 min
      maxQueuedJobsPerTenant: parseInt(process.env.MAX_QUEUED_JOBS_PER_TENANT || '5', 10),
    },
    whatsapp: {
      verifyToken: getEnvVar('WHATSAPP_VERIFY_TOKEN'),
      appSecret: getEnvVar('WHATSAPP_APP_SECRET'),
      accessToken: getEnvVar('WHATSAPP_ACCESS_TOKEN'),
      phoneNumberId: getEnvVar('WHATSAPP_PHONE_NUMBER_ID'),
    },
  };

  // Add Telegram config if bot token is provided (optional)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    config.telegram = {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
    };
  }

  // Add Gmail OAuth config if both client ID and secret are provided (optional)
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    config.gmail = {
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
    };
  }

  // Add Outlook OAuth config if both client ID and secret are provided (optional)
  if (process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET) {
    config.outlook = {
      clientId: process.env.OUTLOOK_CLIENT_ID,
      clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    };
  }

  return config;
}

// Export singleton config for use throughout the application
// Note: This will be lazily initialized when first imported
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// For testing purposes - reset the cached config
export function resetConfig(): void {
  _config = null;
}
