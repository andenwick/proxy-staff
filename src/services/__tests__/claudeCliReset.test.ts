import { ClaudeCliService, generateCliSessionId } from '../claudeCli.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { getPrismaClient } from '../prisma.js';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

// Mock logger to prevent console output during tests
jest.mock('../../utils/logger.js', () => {
  const createMockLogger = (): Record<string, jest.Mock> => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn(() => createMockLogger()),
  });
  return { logger: createMockLogger(), createRequestLogger: jest.fn(() => createMockLogger()) };
});

// Mock metrics
jest.mock('../../utils/metrics.js', () => ({
  recordTiming: jest.fn(),
  incrementCounter: jest.fn(),
}));

// Create mock Prisma with mutable session data
let mockSession: { id: string; reset_timestamp: Date | null } | null = null;

jest.mock('../prisma.js', () => ({
  getPrismaClient: jest.fn(() => ({
    conversationSession: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(mockSession)),
      updateMany: jest.fn().mockImplementation(({ data }) => {
        if (mockSession) {
          mockSession.reset_timestamp = data.reset_timestamp;
        }
        return Promise.resolve({ count: mockSession ? 1 : 0 });
      }),
    },
  })),
}));

describe('ClaudeCliService Reset Command', () => {
  let service: ClaudeCliService;
  let mockSpawn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock session to a default state
    mockSession = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      reset_timestamp: null,
    };
    service = new ClaudeCliService();
    mockSpawn = spawn as jest.Mock;
  });

  afterEach(() => {
    // Clean up the service
    service.stop();
    mockSession = null;
  });

  describe('resetSession', () => {
    it('resets session by updating reset timestamp in database', async () => {
      const tenantId = 'tenant-123';
      const phone = '+1234567890';

      // Get session ID before reset
      const sessionIdBefore = await service.getSessionId(tenantId, phone);

      // Reset the session (this updates reset_timestamp in our mock)
      await service.resetSession(tenantId, phone);

      // Get session ID after reset - should be different due to new reset_timestamp
      const sessionIdAfter = await service.getSessionId(tenantId, phone);

      expect(sessionIdBefore).not.toBe(sessionIdAfter);
      expect(sessionIdAfter).toHaveLength(36); // UUID format
    });

    it('invalidates old session ID on reset', async () => {
      const tenantId = 'tenant-456';
      const phone = '+0987654321';

      // Get multiple session IDs before reset - should be the same
      const sessionId1 = await service.getSessionId(tenantId, phone);
      const sessionId2 = await service.getSessionId(tenantId, phone);
      expect(sessionId1).toBe(sessionId2);

      // Reset the session
      await service.resetSession(tenantId, phone);

      // Session ID should now be different
      const sessionId3 = await service.getSessionId(tenantId, phone);
      expect(sessionId3).not.toBe(sessionId1);

      // But calling again should return the same new ID
      const sessionId4 = await service.getSessionId(tenantId, phone);
      expect(sessionId3).toBe(sessionId4);
    });

    it('new session uses fresh CLI session ID after reset', async () => {
      const tenantId = 'tenant-789';
      const phone = '+1111111111';

      // Create mock process for sendMessage
      const createMockProcess = () => {
        const mockStdin = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock; on: jest.Mock };
        mockStdin.write = jest.fn();
        mockStdin.end = jest.fn();
        mockStdin.on = jest.fn();

        const mockStdout = new EventEmitter();
        const mockStderr = new EventEmitter();

        const mockProcess = new EventEmitter() as EventEmitter & {
          stdin: typeof mockStdin;
          stdout: typeof mockStdout;
          stderr: typeof mockStderr;
          pid: number;
        };
        mockProcess.stdin = mockStdin;
        mockProcess.stdout = mockStdout;
        mockProcess.stderr = mockStderr;
        mockProcess.pid = 12345;

        return { mockProcess, mockStdout };
      };

      // First message - capture the session ID used
      const { mockProcess: mockProcess1, mockStdout: mockStdout1 } = createMockProcess();
      mockSpawn.mockReturnValueOnce(mockProcess1);

      const promise1 = service.sendMessage(tenantId, phone, 'Hello before reset');
      // Wait for event loop to process and set up handlers
      await new Promise(resolve => setImmediate(resolve));
      mockStdout1.emit('data', Buffer.from('Response 1'));
      mockProcess1.emit('close', 0);
      await promise1;

      const firstCallArgs = mockSpawn.mock.calls[0];
      const firstSessionId = firstCallArgs[1][4]; // --resume or --session-id argument (after -p, --model, model-name)

      // Reset the session
      await service.resetSession(tenantId, phone);

      // Second message - should use different session ID
      const { mockProcess: mockProcess2, mockStdout: mockStdout2 } = createMockProcess();
      mockSpawn.mockReturnValueOnce(mockProcess2);

      const promise2 = service.sendMessage(tenantId, phone, 'Hello after reset');
      // Wait for event loop to process and set up handlers
      await new Promise(resolve => setImmediate(resolve));
      mockStdout2.emit('data', Buffer.from('Response 2'));
      mockProcess2.emit('close', 0);
      await promise2;

      const secondCallArgs = mockSpawn.mock.calls[1];
      const secondSessionId = secondCallArgs[1][4]; // --resume or --session-id argument (after -p, --model, model-name)

      expect(firstSessionId).not.toBe(secondSessionId);
    });
  });

  describe('getSessionId', () => {
    it('returns consistent session ID without reset', async () => {
      const tenantId = 'tenant-abc';
      const phone = '+2222222222';

      const sessionId1 = await service.getSessionId(tenantId, phone);
      const sessionId2 = await service.getSessionId(tenantId, phone);

      expect(sessionId1).toBe(sessionId2);
      expect(sessionId1).toHaveLength(36); // UUID format
    });

    it('returns null when no session exists', async () => {
      mockSession = null;

      const sessionId = await service.getSessionId('tenant-1', '+1111111111');

      expect(sessionId).toBeNull();
    });
  });

  describe('generateCliSessionId (unit tests)', () => {
    it('generates different session IDs for different DB session IDs', () => {
      const sessionId1 = generateCliSessionId('session-1-uuid');
      const sessionId2 = generateCliSessionId('session-2-uuid');
      const sessionId3 = generateCliSessionId('session-3-uuid');

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).not.toBe(sessionId3);
      expect(sessionId2).not.toBe(sessionId3);
    });

    it('includes reset timestamp in hash when provided', () => {
      const dbSessionId = 'session-1-uuid';
      const timestamp = Date.now();

      const withoutTimestamp = generateCliSessionId(dbSessionId);
      const withTimestamp = generateCliSessionId(dbSessionId, timestamp);

      expect(withoutTimestamp).not.toBe(withTimestamp);
    });
  });
});
