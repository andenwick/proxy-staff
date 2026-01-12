process.env.DOTENV_CONFIG_QUIET = 'true';

// Set required environment variables for tests
process.env.ADMIN_API_KEY = 'test-admin-key';

// Mock logger globally to support .child() calls (must be inline due to jest.mock hoisting)
jest.mock('../src/utils/logger.js', () => {
  const createMockLogger = (): Record<string, jest.Mock> => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => createMockLogger()),
  });
  return {
    logger: createMockLogger(),
    createRequestLogger: jest.fn(() => createMockLogger()),
  };
});

// Mock the queue service to prevent Redis connection attempts during tests
// This fixes tests that call endSession -> addSessionEndJob which requires Redis
jest.mock('../src/services/queue/queueService', () => ({
  getRedisConnection: jest.fn(() => ({
    on: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue(undefined),
  })),
  getQueue: jest.fn(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  addSessionEndJob: jest.fn().mockResolvedValue(undefined),
  addJob: jest.fn().mockResolvedValue('mock-job-id'),
  cancelJob: jest.fn().mockResolvedValue(true),
  getActiveJobForUser: jest.fn().mockResolvedValue(null),
  getJob: jest.fn().mockResolvedValue(undefined),
  isRedisHealthy: jest.fn().mockResolvedValue(true),
  getQueueStats: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
  shutdown: jest.fn().mockResolvedValue(undefined),
  generateDedupHash: jest.fn((tenantId: string, senderPhone: string, message: string) =>
    `mock-hash-${tenantId}-${senderPhone}`
  ),
  isDuplicate: jest.fn().mockReturnValue(false),
  recordJobHash: jest.fn(),
  cleanupDedupHashes: jest.fn(),
  startDedupCleanup: jest.fn(),
  stopDedupCleanup: jest.fn(),
  acquireLock: jest.fn().mockResolvedValue(true),
  releaseLock: jest.fn().mockResolvedValue(undefined),
}));
