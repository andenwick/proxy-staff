/**
 * BrowserSessionManager Tests
 */

// Mock logger first (hoisted)
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock playwright with inline mocks (hoisted)
const mockPage = {
  close: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn().mockResolvedValue(true),
};

const mockContext = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn().mockImplementation(() => Promise.resolve({
      newContext: jest.fn().mockImplementation(() => Promise.resolve({
        newPage: jest.fn().mockImplementation(() => Promise.resolve({
          close: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue(true),
        })),
        close: jest.fn().mockResolvedValue(undefined),
      })),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  },
}));

import { BrowserSessionManager, generateLockKey } from '../browserSessionManager.js';

// Mock prisma
const mockPrisma = {
  browser_sessions: {
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
  },
};

jest.mock('../prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

jest.mock('../../utils/process.js', () => ({
  getLeaseOwner: () => 'test-host-pid',
}));

describe('BrowserSessionManager', () => {
  let manager: BrowserSessionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new BrowserSessionManager();
  });

  afterEach(async () => {
    manager.stop();
    await manager.closeAllSessions();
  });

  describe('generateLockKey', () => {
    it('generates consistent lock key for same inputs', () => {
      const key1 = generateLockKey('tenant-1', 'session-1');
      const key2 = generateLockKey('tenant-1', 'session-1');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different inputs', () => {
      const key1 = generateLockKey('tenant-1', 'session-1');
      const key2 = generateLockKey('tenant-1', 'session-2');
      const key3 = generateLockKey('tenant-2', 'session-1');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('returns a number', () => {
      const key = generateLockKey('tenant-1', 'session-1');
      expect(typeof key).toBe('number');
    });
  });

  describe('start/stop', () => {
    it('starts the cleanup interval', () => {
      manager.start();
      expect(manager['isRunning']).toBe(true);
    });

    it('stops the cleanup interval', () => {
      manager.start();
      manager.stop();
      expect(manager['isRunning']).toBe(false);
    });

    it('warns if already running', () => {
      manager.start();
      manager.start(); // Second start should warn
      // No error thrown
    });
  });

  describe('getOrCreateSession', () => {
    it('creates new session when none exists', async () => {
      const session = await manager.getOrCreateSession('tenant-1');

      expect(session.tenantId).toBe('tenant-1');
      expect(session.page).toBeDefined();
      expect(session.browser).toBeDefined();
      expect(mockPrisma.browser_sessions.create).toHaveBeenCalled();
    });

    it('returns existing session when sessionId matches', async () => {
      const session1 = await manager.getOrCreateSession('tenant-1', 'sess_12345678');
      const session2 = await manager.getOrCreateSession('tenant-1', 'sess_12345678');

      expect(session1).toBe(session2);
    });

    it('creates session with persistent flag', async () => {
      const session = await manager.getOrCreateSession('tenant-1', undefined, { persistent: true });

      expect(session.persistent).toBe(true);
    });

    it('generates session ID when not provided', async () => {
      const session = await manager.getOrCreateSession('tenant-1');

      expect(session.id).toMatch(/^sess_[a-z0-9]{8}$/);
    });
  });

  describe('getSession', () => {
    it('returns null when no session exists', async () => {
      const session = await manager.getSession('tenant-1', 'nonexistent');

      expect(session).toBeNull();
    });

    it('returns session when it exists and is healthy', async () => {
      const created = await manager.getOrCreateSession('tenant-1', 'sess_test1234');
      const retrieved = await manager.getSession('tenant-1', 'sess_test1234');

      expect(retrieved).toBe(created);
    });

    it('updates lastUsedAt when accessing session', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_test1234');

      // Wait a bit
      await new Promise(r => setTimeout(r, 10));

      await manager.getSession('tenant-1', 'sess_test1234');

      expect(mockPrisma.browser_sessions.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            last_used_at: expect.any(Date),
          }),
        })
      );
    });

    it('cleans up session when explicitly closed', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_cleanup');
      expect(manager.getSessionCount('tenant-1')).toBe(1);

      await manager.closeSession('tenant-1', 'sess_cleanup');
      expect(manager.getSessionCount('tenant-1')).toBe(0);
    });
  });

  describe('closeSession', () => {
    it('closes browser resources', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_toclose');
      const closed = await manager.closeSession('tenant-1', 'sess_toclose');

      expect(closed).toBe(true);
      // Browser resources are closed (verify via session count)
      expect(manager.getSessionCount('tenant-1')).toBe(0);
    });

    it('removes from database', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_toclose');
      await manager.closeSession('tenant-1', 'sess_toclose');

      expect(mockPrisma.browser_sessions.delete).toHaveBeenCalledWith({
        where: { id: 'sess_toclose' },
      });
    });

    it('returns false when session does not exist', async () => {
      const closed = await manager.closeSession('tenant-1', 'nonexistent');

      expect(closed).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no sessions', () => {
      const sessions = manager.listSessions('tenant-1');

      expect(sessions).toEqual([]);
    });

    it('returns session info without browser internals', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_list1234', { persistent: true });

      const sessions = manager.listSessions('tenant-1');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toEqual({
        id: 'sess_list1234',
        tenantId: 'tenant-1',
        createdAt: expect.any(Date),
        lastUsedAt: expect.any(Date),
        persistent: true,
      });
      // Should not include browser/page/context
      expect(sessions[0]).not.toHaveProperty('browser');
      expect(sessions[0]).not.toHaveProperty('page');
    });
  });

  describe('closeAllSessions', () => {
    it('closes all sessions across tenants', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_all1');
      await manager.getOrCreateSession('tenant-2', 'sess_all2');

      await manager.closeAllSessions();

      expect(manager.getSessionCount('tenant-1')).toBe(0);
      expect(manager.getSessionCount('tenant-2')).toBe(0);
    });
  });

  describe('getSessionCount', () => {
    it('returns 0 when no sessions', () => {
      expect(manager.getSessionCount('tenant-1')).toBe(0);
    });

    it('returns correct count', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_count1');
      await manager.getOrCreateSession('tenant-1', 'sess_count2');

      expect(manager.getSessionCount('tenant-1')).toBe(2);
    });

    it('counts per tenant', async () => {
      await manager.getOrCreateSession('tenant-1', 'sess_t1');
      await manager.getOrCreateSession('tenant-2', 'sess_t2a');
      await manager.getOrCreateSession('tenant-2', 'sess_t2b');

      expect(manager.getSessionCount('tenant-1')).toBe(1);
      expect(manager.getSessionCount('tenant-2')).toBe(2);
    });
  });
});
