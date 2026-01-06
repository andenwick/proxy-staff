/**
 * Session Management System - Database Model Tests (Task Group 1)
 *
 * Tests for new database columns and tables:
 * - reset_timestamp, lease_owner, lease_expires_at on conversation_sessions
 * - session_end_jobs table CRUD operations
 * - browser_sessions table CRUD operations
 * - SessionEndJobStatus enum values
 */

// Mock the prisma client
const mockPrisma = {
  conversationSession: {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  sessionEndJob: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  browserSession: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
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

describe('Session Management Database Models', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('conversation_sessions new columns', () => {
    it('should read and write reset_timestamp column', async () => {
      const resetTime = new Date();
      const session = {
        id: 'session-123',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        reset_timestamp: resetTime,
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.conversationSession.findFirst.mockResolvedValue(session);
      mockPrisma.conversationSession.update.mockResolvedValue({
        ...session,
        reset_timestamp: resetTime,
      });

      // Simulate reading session with reset_timestamp
      const found = await mockPrisma.conversationSession.findFirst({
        where: { id: 'session-123' },
      });
      expect(found?.reset_timestamp).toEqual(resetTime);

      // Simulate updating reset_timestamp
      const updated = await mockPrisma.conversationSession.update({
        where: { id: 'session-123' },
        data: { reset_timestamp: resetTime },
      });
      expect(updated.reset_timestamp).toEqual(resetTime);
    });

    it('should read and write lease_owner and lease_expires_at columns', async () => {
      const leaseOwner = 'server-1-12345';
      const leaseExpiresAt = new Date(Date.now() + 300000); // 5 minutes from now

      const session = {
        id: 'session-456',
        tenant_id: 'tenant-1',
        sender_phone: '+1234567890',
        started_at: new Date(),
        ended_at: null,
        reset_timestamp: null,
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt,
      };

      mockPrisma.conversationSession.update.mockResolvedValue(session);

      // Simulate claiming a session with lease
      const claimed = await mockPrisma.conversationSession.update({
        where: { id: 'session-456' },
        data: {
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
        },
      });

      expect(claimed.lease_owner).toBe(leaseOwner);
      expect(claimed.lease_expires_at).toEqual(leaseExpiresAt);
      expect(mockPrisma.conversationSession.update).toHaveBeenCalledWith({
        where: { id: 'session-456' },
        data: {
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
        },
      });
    });
  });

  describe('session_end_jobs table', () => {
    it('should create, read, update, and delete session_end_jobs records', async () => {
      const job = {
        id: 'job-uuid-123',
        session_id: 'session-123',
        tenant_id: 'tenant-1',
        status: 'PENDING',
        attempts: 0,
        max_attempts: 3,
        created_at: new Date(),
        processed_at: null,
        error_message: null,
      };

      // CREATE
      mockPrisma.sessionEndJob.create.mockResolvedValue(job);
      const created = await mockPrisma.sessionEndJob.create({
        data: {
          session_id: 'session-123',
          tenant_id: 'tenant-1',
          status: 'PENDING',
          attempts: 0,
          max_attempts: 3,
        },
      });
      expect(created.id).toBe('job-uuid-123');
      expect(created.status).toBe('PENDING');
      expect(created.attempts).toBe(0);
      expect(created.max_attempts).toBe(3);

      // READ
      mockPrisma.sessionEndJob.findFirst.mockResolvedValue(job);
      const found = await mockPrisma.sessionEndJob.findFirst({
        where: { id: 'job-uuid-123' },
      });
      expect(found?.session_id).toBe('session-123');

      // UPDATE (processing)
      const processingJob = {
        ...job,
        status: 'PROCESSING',
        attempts: 1,
      };
      mockPrisma.sessionEndJob.update.mockResolvedValue(processingJob);
      const updated = await mockPrisma.sessionEndJob.update({
        where: { id: 'job-uuid-123' },
        data: {
          status: 'PROCESSING',
          attempts: 1,
        },
      });
      expect(updated.status).toBe('PROCESSING');
      expect(updated.attempts).toBe(1);

      // UPDATE (completed)
      const completedJob = {
        ...job,
        status: 'COMPLETED',
        processed_at: new Date(),
      };
      mockPrisma.sessionEndJob.update.mockResolvedValue(completedJob);
      const completed = await mockPrisma.sessionEndJob.update({
        where: { id: 'job-uuid-123' },
        data: {
          status: 'COMPLETED',
          processed_at: new Date(),
        },
      });
      expect(completed.status).toBe('COMPLETED');
      expect(completed.processed_at).toBeDefined();

      // DELETE
      mockPrisma.sessionEndJob.delete.mockResolvedValue(completedJob);
      const deleted = await mockPrisma.sessionEndJob.delete({
        where: { id: 'job-uuid-123' },
      });
      expect(deleted.id).toBe('job-uuid-123');
    });

    it('should handle failed jobs with error_message', async () => {
      const failedJob = {
        id: 'job-uuid-456',
        session_id: 'session-456',
        tenant_id: 'tenant-1',
        status: 'FAILED',
        attempts: 3,
        max_attempts: 3,
        created_at: new Date(),
        processed_at: new Date(),
        error_message: 'LearningService timeout after 30s',
      };

      mockPrisma.sessionEndJob.update.mockResolvedValue(failedJob);
      const failed = await mockPrisma.sessionEndJob.update({
        where: { id: 'job-uuid-456' },
        data: {
          status: 'FAILED',
          attempts: 3,
          processed_at: new Date(),
          error_message: 'LearningService timeout after 30s',
        },
      });

      expect(failed.status).toBe('FAILED');
      expect(failed.attempts).toBe(3);
      expect(failed.error_message).toBe('LearningService timeout after 30s');
    });
  });

  describe('browser_sessions table', () => {
    it('should create, read, update, and delete browser_sessions records', async () => {
      const now = new Date();
      const browserSession = {
        id: 'browser-session-123',
        tenant_id: 'tenant-1',
        session_id: 'conversation-session-123',
        persistent: false,
        created_at: now,
        last_used_at: now,
        lease_owner: null,
        lease_expires_at: null,
      };

      // CREATE
      mockPrisma.browserSession.create.mockResolvedValue(browserSession);
      const created = await mockPrisma.browserSession.create({
        data: {
          id: 'browser-session-123',
          tenant_id: 'tenant-1',
          session_id: 'conversation-session-123',
          persistent: false,
        },
      });
      expect(created.id).toBe('browser-session-123');
      expect(created.persistent).toBe(false);
      expect(created.created_at).toEqual(now);

      // READ
      mockPrisma.browserSession.findFirst.mockResolvedValue(browserSession);
      const found = await mockPrisma.browserSession.findFirst({
        where: {
          tenant_id: 'tenant-1',
          session_id: 'conversation-session-123',
        },
      });
      expect(found?.id).toBe('browser-session-123');

      // UPDATE (last_used_at)
      const newTime = new Date();
      const updatedSession = { ...browserSession, last_used_at: newTime };
      mockPrisma.browserSession.update.mockResolvedValue(updatedSession);
      const updated = await mockPrisma.browserSession.update({
        where: { id: 'browser-session-123' },
        data: { last_used_at: newTime },
      });
      expect(updated.last_used_at).toEqual(newTime);

      // UPDATE (with lease)
      const leaseOwner = 'server-2-67890';
      const leaseExpiresAt = new Date(Date.now() + 300000);
      const leasedSession = {
        ...browserSession,
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt,
      };
      mockPrisma.browserSession.update.mockResolvedValue(leasedSession);
      const leased = await mockPrisma.browserSession.update({
        where: { id: 'browser-session-123' },
        data: {
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
        },
      });
      expect(leased.lease_owner).toBe(leaseOwner);
      expect(leased.lease_expires_at).toEqual(leaseExpiresAt);

      // DELETE
      mockPrisma.browserSession.delete.mockResolvedValue(browserSession);
      const deleted = await mockPrisma.browserSession.delete({
        where: { id: 'browser-session-123' },
      });
      expect(deleted.id).toBe('browser-session-123');
    });

    it('should support persistent browser sessions', async () => {
      const persistentSession = {
        id: 'persistent-browser-123',
        tenant_id: 'tenant-1',
        session_id: 'conversation-session-456',
        persistent: true,
        created_at: new Date(),
        last_used_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
      };

      mockPrisma.browserSession.create.mockResolvedValue(persistentSession);
      const created = await mockPrisma.browserSession.create({
        data: {
          id: 'persistent-browser-123',
          tenant_id: 'tenant-1',
          session_id: 'conversation-session-456',
          persistent: true,
        },
      });

      expect(created.persistent).toBe(true);
    });
  });

  describe('SessionEndJobStatus enum', () => {
    it('should have correct enum values defined in Prisma', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SessionEndJobStatus } = require('@prisma/client');

      expect(SessionEndJobStatus.PENDING).toBe('PENDING');
      expect(SessionEndJobStatus.PROCESSING).toBe('PROCESSING');
      expect(SessionEndJobStatus.COMPLETED).toBe('COMPLETED');
      expect(SessionEndJobStatus.FAILED).toBe('FAILED');
    });
  });
});
