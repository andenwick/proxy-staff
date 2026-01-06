/**
 * Session Service Tests (Legacy)
 *
 * These tests verify the basic session operations.
 * For comprehensive session service tests including transactions and leasing,
 * see sessionService.test.ts (Task Group 2).
 */

import { getOrCreateSession, endSession, createSession, getLeaseOwner } from '../session.js';
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

describe('session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateSession', () => {
    it('should return isNew: false when reusing active session with recent message', async () => {
      const existingSession = {
        id: 'existing-session-123',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      // Mock transaction behavior
      mockPrisma.$transaction.mockImplementation(async (callback) => {
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

    it('should return isNew: true when session expired (no messages in 24h)', async () => {
      const newSession = {
        id: 'new-session-456',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: getLeaseOwner(),
        lease_expires_at: new Date(Date.now() + 300000),
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // No existing session found
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.conversationSession.create.mockResolvedValue(newSession);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result).toEqual({
        sessionId: 'new-session-456',
        isNew: true,
      });
    });

    it('should end expired sessions when creating new one', async () => {
      const newSession = {
        id: 'new-session-789',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: getLeaseOwner(),
        lease_expires_at: new Date(Date.now() + 300000),
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 2 });
        mockPrisma.conversationSession.create.mockResolvedValue(newSession);
        return callback(mockPrisma);
      });

      await getOrCreateSession('tenant-1', '+1234567890');

      // Verify updateMany was called to end expired sessions
      expect(mockPrisma.conversationSession.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          sender_phone: '+1234567890',
          ended_at: null,
        },
        data: {
          ended_at: expect.any(Date),
          lease_owner: null,
          lease_expires_at: null,
        },
      });
    });

    it('should use 24-hour timeout window - message at 23h59m is still active', async () => {
      const now = new Date();
      const almostExpiredSession = {
        id: 'almost-expired-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 60000), // 23h59m ago
        ended_at: null,
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([almostExpiredSession]);
        mockPrisma.conversationSession.update.mockResolvedValue(almostExpiredSession);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result.isNew).toBe(false);
      expect(result.sessionId).toBe('almost-expired-session');
    });

    it('should use 24-hour timeout window - message at 24h01m creates new session', async () => {
      const newSession = {
        id: 'brand-new-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: getLeaseOwner(),
        lease_expires_at: new Date(Date.now() + 300000),
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        // No active session found (message older than 24h)
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.conversationSession.create.mockResolvedValue(newSession);
        return callback(mockPrisma);
      });

      const result = await getOrCreateSession('tenant-1', '+1234567890');

      expect(result.isNew).toBe(true);
      expect(result.sessionId).toBe('brand-new-session');
    });

    it('should use transaction for atomic session operations', async () => {
      const newSession = {
        id: 'test-session',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: getLeaseOwner(),
        lease_expires_at: new Date(Date.now() + 300000),
      };

      mockPrisma.$transaction.mockImplementation(async (callback) => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.conversationSession.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.conversationSession.create.mockResolvedValue(newSession);
        return callback(mockPrisma);
      });

      await getOrCreateSession('tenant-1', '+1234567890');

      // Verify transaction was used
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    it('should set ended_at timestamp and clear lease', async () => {
      mockPrisma.conversationSession.update.mockResolvedValue({
        id: 'session-to-end',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        ended_at: new Date(),
      });

      await endSession('session-to-end');

      expect(mockPrisma.conversationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-to-end' },
        data: {
          ended_at: expect.any(Date),
          lease_owner: null,
          lease_expires_at: null,
        },
      });
    });

    it('should queue learning trigger job via BullMQ', async () => {
      const beforeCall = new Date();

      mockPrisma.conversationSession.update.mockResolvedValue({
        id: 'session-123',
        tenant_id: 'tenant-2',
        sender_phone: '+1234567890',
        ended_at: new Date(),
      });

      await endSession('session-123');

      const afterCall = new Date();

      const updateCall = mockPrisma.conversationSession.update.mock.calls[0][0];
      const endedAt = updateCall.data.ended_at;

      expect(endedAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(endedAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());

      // Verify addSessionEndJob was called (now uses BullMQ instead of database)
      expect(mockAddSessionEndJob).toHaveBeenCalledWith(
        'session-123',
        'tenant-2',
        '+1234567890',
        'expiry'
      );
    });
  });

  describe('createSession', () => {
    it('should create a new session with lease and return the session ID', async () => {
      mockPrisma.conversationSession.create.mockResolvedValue({
        id: 'created-session-abc',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        lease_owner: getLeaseOwner(),
        lease_expires_at: new Date(Date.now() + 300000),
      });

      const sessionId = await createSession('tenant-1', '+1234567890');

      expect(sessionId).toBe('created-session-abc');
      expect(mockPrisma.conversationSession.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          sender_phone: '+1234567890',
          lease_owner: getLeaseOwner(),
          lease_expires_at: expect.any(Date),
        },
      });
    });
  });
});
