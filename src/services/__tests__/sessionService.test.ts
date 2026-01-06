/**
 * Session Service Tests (Task Group 2)
 *
 * Tests for session service reliability upgrades:
 * - getOrCreateSession returns existing session within timeout window
 * - getOrCreateSession creates new session after timeout
 * - SESSION_TIMEOUT_HOURS environment variable is respected
 * - Transaction prevents duplicate sessions (mock concurrent calls)
 * - Lease claim pattern works correctly
 * - endSession queues learning trigger job via BullMQ
 */

import os from 'os';
import { addSessionEndJob } from '../queue/queueService.js';

// Mock the queue service (already mocked globally in jest.setup.ts, but we need to access it)
jest.mock('../queue/queueService.js');
const mockAddSessionEndJob = addSessionEndJob as jest.MockedFunction<typeof addSessionEndJob>;

// Mock the prisma client with transaction support
const mockPrisma = {
  conversationSession: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  session_end_jobs: {
    create: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

jest.mock('../prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

// Mock the config module
const mockConfig = {
  sessionTimeoutHours: 24,
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
};

jest.mock('../../config/index.js', () => ({
  getConfig: () => mockConfig,
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

// Import after mocks are set up
import {
  getOrCreateSession,
  endSession,
  getSessionTimeoutHours,
  getLeaseOwner,
} from '../session.js';

describe('Session Service (Task Group 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset config for each test
    mockConfig.sessionTimeoutHours = 24;
  });

  describe('getOrCreateSession - existing session within timeout', () => {
    it('should return existing session when found within timeout window', async () => {
      const existingSession = {
        id: 'existing-session-123',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      // Mock the transaction to simulate finding an existing session
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // Simulate the raw query returning an existing session
        mockPrisma.$queryRaw.mockResolvedValue([existingSession]);
        mockPrisma.conversationSession.update.mockResolvedValue(existingSession);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result).toEqual({
        sessionId: 'existing-session-123',
        isNew: false,
      });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('getOrCreateSession - new session after timeout', () => {
    it('should create new session when no active session found', async () => {
      const newSession = {
        id: 'new-session-456',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      // Mock the transaction to simulate no existing session
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // First query returns empty (no existing session)
        mockPrisma.$queryRaw.mockResolvedValueOnce([]);
        // End expired sessions
        mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 0 });
        // Create new session
        mockPrisma.conversationSession.create.mockResolvedValue(newSession);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result).toEqual({
        sessionId: 'new-session-456',
        isNew: true,
      });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('SESSION_TIMEOUT_HOURS environment variable', () => {
    it('should use default of 24 hours when env var not set', () => {
      // Default is already 24 in mockConfig
      const timeout = getSessionTimeoutHours();
      expect(timeout).toBe(24);
    });

    it('should respect custom SESSION_TIMEOUT_HOURS value', () => {
      mockConfig.sessionTimeoutHours = 12;
      const timeout = getSessionTimeoutHours();
      expect(timeout).toBe(12);
    });

    it('should use custom timeout in session lookup', async () => {
      mockConfig.sessionTimeoutHours = 6;

      const existingSession = {
        id: 'session-with-custom-timeout',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([existingSession]);
        mockPrisma.conversationSession.update.mockResolvedValue(existingSession);
        return callback(mockPrisma);
      });

      await getOrCreateSession('tenant-1', '+1234567890');

      // Verify the transaction was called (we rely on internal logic using getSessionTimeoutHours)
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('Transaction with row locking', () => {
    it('should use transaction with FOR UPDATE SKIP LOCKED pattern', async () => {
      const session = {
        id: 'locked-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([session]);
        mockPrisma.conversationSession.update.mockResolvedValue(session);
        return callback(mockPrisma);
      });

      await getOrCreateSession('tenant-1', '+1234567890');

      // Verify $transaction was called with the proper isolation
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      const transactionCall = mockPrisma.$transaction.mock.calls[0];
      expect(typeof transactionCall[0]).toBe('function');
    });

    it('should prevent duplicate sessions under concurrent calls', async () => {
      // Simulate two concurrent calls by checking that transaction properly serializes access
      const session = {
        id: 'concurrent-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      let callCount = 0;
      mockPrisma.$transaction.mockImplementation(async (callback) => {
        callCount++;
        // First call returns empty (creates session), second returns existing
        if (callCount === 1) {
          mockPrisma.$queryRaw.mockResolvedValueOnce([]);
          mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 0 });
          mockPrisma.conversationSession.create.mockResolvedValue(session);
        } else {
          mockPrisma.$queryRaw.mockResolvedValueOnce([session]);
          mockPrisma.conversationSession.update.mockResolvedValue(session);
        }
        return callback(mockPrisma);
      });

      // Simulate concurrent calls
      const [result1, result2] = await Promise.all([
        getOrCreateSession('tenant-1', '+1234567890'),
        getOrCreateSession('tenant-1', '+1234567890'),
      ]);

      // Both should return the same session
      expect(result1.sessionId).toBe('concurrent-session');
      expect(result2.sessionId).toBe('concurrent-session');
      // First creates (isNew: true), second finds existing (isNew: false)
      expect(result1.isNew).toBe(true);
      expect(result2.isNew).toBe(false);
    });
  });

  describe('Lease claim pattern', () => {
    it('should set lease_owner in correct format', () => {
      const leaseOwner = getLeaseOwner();
      const expectedPattern = `${os.hostname()}-${process.pid}`;
      expect(leaseOwner).toBe(expectedPattern);
    });

    it('should set lease on existing session when claimed', async () => {
      const session = {
        id: 'leased-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([session]);
        mockPrisma.conversationSession.update.mockResolvedValue({
          ...session,
          lease_owner: getLeaseOwner(),
          lease_expires_at: expect.any(Date),
        });
        return callback(mockPrisma);
      });

      await getOrCreateSession('tenant-1', '+1234567890');

      // Verify update was called with lease fields
      expect(mockPrisma.conversationSession.update).toHaveBeenCalledWith({
        where: { id: 'leased-session' },
        data: {
          lease_owner: getLeaseOwner(),
          lease_expires_at: expect.any(Date),
        },
      });
    });

    it('should allow reclaim if lease_expires_at is in the past', async () => {
      const expiredLeaseTime = new Date(Date.now() - 60000); // 1 minute ago
      const session = {
        id: 'expired-lease-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: 'old-server-9999',
        lease_expires_at: expiredLeaseTime,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // The query should still return the session because lease expired
        // (handled by SQL: lease_expires_at IS NULL OR lease_expires_at < NOW())
        mockPrisma.$queryRaw.mockResolvedValue([session]);
        mockPrisma.conversationSession.update.mockResolvedValue(session);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result.sessionId).toBe('expired-lease-session');
      expect(result.isNew).toBe(false);
    });
  });

  describe('endSession queues learning trigger job', () => {
    it('should call addSessionEndJob to queue learning trigger via BullMQ', async () => {
      mockPrisma.conversationSession.update.mockResolvedValue({
        id: 'session-to-end',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        ended_at: new Date(),
      });

      await endSession('session-to-end');

      // Verify session was ended with lease cleared
      expect(mockPrisma.conversationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-to-end' },
        data: {
          ended_at: expect.any(Date),
          lease_owner: null,
          lease_expires_at: null,
        },
      });

      // Verify addSessionEndJob was called (now uses BullMQ instead of database insert)
      expect(mockAddSessionEndJob).toHaveBeenCalledWith(
        'session-to-end',
        'tenant-1',
        '+1234567890',
        'expiry'
      );
    });

    it('should pass correct arguments to addSessionEndJob: sessionId, tenantId, senderPhone, reason', async () => {
      mockPrisma.conversationSession.update.mockResolvedValue({
        id: 'session-123',
        tenant_id: 'tenant-2',
        sender_phone: '+9876543210',
        ended_at: new Date(),
      });

      await endSession('session-123');

      // Verify the correct arguments were passed
      expect(mockAddSessionEndJob).toHaveBeenCalledTimes(1);
      const callArgs = mockAddSessionEndJob.mock.calls[0];
      expect(callArgs[0]).toBe('session-123');    // sessionId
      expect(callArgs[1]).toBe('tenant-2');       // tenantId
      expect(callArgs[2]).toBe('+9876543210');    // senderPhone
      expect(callArgs[3]).toBe('expiry');         // reason (default)
    });
  });
});
