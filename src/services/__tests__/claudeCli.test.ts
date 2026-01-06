import { ClaudeCliService, generateCliSessionId } from '../claudeCli.js';
import { ClaudeCliError } from '../../errors/index.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

// Mock logger to prevent console output during tests
jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock metrics
jest.mock('../../utils/metrics.js', () => ({
  recordTiming: jest.fn(),
  incrementCounter: jest.fn(),
}));

// Mock prisma client
jest.mock('../prisma.js', () => ({
  getPrismaClient: jest.fn(() => ({
    conversationSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  })),
}));

describe('ClaudeCliService', () => {
  let service: ClaudeCliService;
  let mockSpawn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClaudeCliService();
    mockSpawn = spawn as jest.Mock;
  });

  afterEach(() => {
    // Clean up the service to stop cleanup intervals
    service.stop();
  });

  describe('generateCliSessionId', () => {
    it('generates deterministic session ID for same DB session ID', () => {
      const dbSessionId = '550e8400-e29b-41d4-a716-446655440000';

      const sessionId1 = generateCliSessionId(dbSessionId);
      const sessionId2 = generateCliSessionId(dbSessionId);

      expect(sessionId1).toBe(sessionId2);
      expect(sessionId1).toHaveLength(36); // UUID format
    });

    it('generates different session IDs for different DB session IDs', () => {
      const sessionId1 = generateCliSessionId('550e8400-e29b-41d4-a716-446655440000');
      const sessionId2 = generateCliSessionId('660e8400-e29b-41d4-a716-446655440001');
      const sessionId3 = generateCliSessionId('770e8400-e29b-41d4-a716-446655440002');

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).not.toBe(sessionId3);
      expect(sessionId2).not.toBe(sessionId3);
    });

    it('generates different session ID with reset timestamp', () => {
      const dbSessionId = '550e8400-e29b-41d4-a716-446655440000';
      const resetTimestamp = Date.now();

      const sessionIdNoReset = generateCliSessionId(dbSessionId);
      const sessionIdWithReset = generateCliSessionId(dbSessionId, resetTimestamp);

      expect(sessionIdNoReset).not.toBe(sessionIdWithReset);
      expect(sessionIdWithReset).toHaveLength(36); // UUID format
    });
  });

  describe('sendMessage', () => {
    // Helper to create a mock process
    function createMockProcess() {
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
        kill: jest.Mock;
        pid: number;
      };
      mockProcess.stdin = mockStdin;
      mockProcess.stdout = mockStdout;
      mockProcess.stderr = mockStderr;
      mockProcess.kill = jest.fn();
      mockProcess.pid = 12345;

      return { mockProcess, mockStdin, mockStdout, mockStderr };
    }

    it('sends message via subprocess and returns response', async () => {
      // First call (--resume) fails with "No conversation found"
      const resumeProcess = createMockProcess();
      // Second call (--session-id) succeeds
      const sessionProcess = createMockProcess();

      mockSpawn
        .mockReturnValueOnce(resumeProcess.mockProcess)
        .mockReturnValueOnce(sessionProcess.mockProcess);

      const messagePromise = service.sendMessage('tenant-123', '+1234567890', 'Hello Claude');

      // Let the event loop process (needed for async flow)
      await new Promise(resolve => setImmediate(resolve));

      // First call (--resume) fails
      resumeProcess.mockStderr.emit('data', Buffer.from('No conversation found'));
      resumeProcess.mockProcess.emit('close', 1);

      // Wait for fallback
      await new Promise(resolve => setImmediate(resolve));

      // Second call (--session-id) succeeds
      sessionProcess.mockStdout.emit('data', Buffer.from('Hello! I am Claude.'));
      sessionProcess.mockProcess.emit('close', 0);

      const response = await messagePromise;

      expect(response).toBe('Hello! I am Claude.');
      // First call should be with --resume and --setting-sources
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        'claude',
        ['-p', '--resume', expect.any(String), '--setting-sources', 'user,project,local', '--dangerously-skip-permissions'],
        expect.objectContaining({
          cwd: expect.stringContaining('tenants'),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
      // Second call should be with --session-id (fallback) and --setting-sources
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        'claude',
        ['-p', '--session-id', expect.any(String), '--setting-sources', 'user,project,local', '--dangerously-skip-permissions'],
        expect.objectContaining({
          cwd: expect.stringContaining('tenants'),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('handles subprocess failure with non-zero exit code', async () => {
      // Both calls fail with non-"No conversation found" error
      const resumeProcess = createMockProcess();

      mockSpawn.mockReturnValue(resumeProcess.mockProcess);

      const messagePromise = service.sendMessage('tenant-123', '+1234567890', 'Hello');

      // Wait for process to start
      await new Promise(resolve => setImmediate(resolve));

      // Simulate error in stderr (not "No conversation found", so no fallback)
      resumeProcess.mockStderr.emit('data', Buffer.from('Command not found'));
      resumeProcess.mockProcess.emit('close', 1);

      await expect(messagePromise).rejects.toThrow(ClaudeCliError);
      await expect(messagePromise).rejects.toThrow('Claude CLI failed: Command not found');
    });

    it('handles timeout with AbortController', async () => {
      // Create service with short timeout for testing
      const shortTimeoutService = new ClaudeCliService(100);

      try {
        const resumeProcess = createMockProcess();
        mockSpawn.mockReturnValue(resumeProcess.mockProcess);

        const messagePromise = shortTimeoutService.sendMessage('tenant-123', '+1234567890', 'Hello');

        // Wait for process to start
        await new Promise(resolve => setImmediate(resolve));

        // Simulate timeout by emitting error with AbortError
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        resumeProcess.mockProcess.emit('error', abortError);

        await expect(messagePromise).rejects.toThrow(ClaudeCliError);
        await expect(messagePromise).rejects.toThrow('timed out');
      } finally {
        shortTimeoutService.stop();
      }
    });

    it('handles spawn error when CLI not found', async () => {
      const resumeProcess = createMockProcess();
      mockSpawn.mockReturnValue(resumeProcess.mockProcess);

      const messagePromise = service.sendMessage('tenant-123', '+1234567890', 'Hello');

      // Wait for process to start
      await new Promise(resolve => setImmediate(resolve));

      // Simulate spawn error (e.g., CLI not installed)
      const spawnError = new Error('spawn claude ENOENT');
      resumeProcess.mockProcess.emit('error', spawnError);

      await expect(messagePromise).rejects.toThrow(ClaudeCliError);
      await expect(messagePromise).rejects.toThrow('Failed to spawn Claude CLI');
    });
  });

  describe('constructor', () => {
    it('uses default timeout of 5 minutes', () => {
      const defaultService = new ClaudeCliService();
      try {
        // Access private property for testing
        expect((defaultService as any).timeoutMs).toBe(300000);
      } finally {
        defaultService.stop();
      }
    });

    it('accepts custom timeout', () => {
      const customService = new ClaudeCliService(60000);
      try {
        expect((customService as any).timeoutMs).toBe(60000);
      } finally {
        customService.stop();
      }
    });
  });
});
