/**
 * Task Group 4 Tests: Browser Session Database Persistence and Distributed Locking
 *
 * Tests for:
 * - getOrCreateSession persists session metadata to database
 * - closeSession removes database record
 * - Orphaned database records cleaned up on startup
 * - Lease pattern prevents concurrent session access
 */

import os from 'os';

// Mock Prisma client
const mockPrismaClient = {
  browser_sessions: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// Mock getPrismaClient
jest.mock('../src/services/prisma', () => ({
  getPrismaClient: () => mockPrismaClient,
}));

// Mock Playwright - don't launch real browsers in tests
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn().mockResolvedValue({
      close: jest.fn().mockResolvedValue(undefined),
      newContext: jest.fn().mockResolvedValue({
        close: jest.fn().mockResolvedValue(undefined),
        newPage: jest.fn().mockResolvedValue({
          close: jest.fn().mockResolvedValue(undefined),
          evaluate: jest.fn().mockResolvedValue(true),
        }),
      }),
    }),
  },
}));

// Import after mocking
import { BrowserSessionManager, generateLockKey, getLeaseOwner } from '../src/services/browserSessionManager';

describe('Task Group 4: Browser Session Database Persistence', () => {
  let manager: BrowserSessionManager;
  const testTenantId = 'tenant-123';
  const testSessionId = 'sess_abc12345';

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new BrowserSessionManager();
  });

  afterEach(async () => {
    manager.stop();
  });

  // Test 1: getOrCreateSession persists session metadata to database
  test('getOrCreateSession persists session metadata to database', async () => {
    // Mock: no existing session in database
    mockPrismaClient.$queryRaw.mockResolvedValue([]);

    // Mock successful database insert
    mockPrismaClient.browser_sessions.create.mockResolvedValue({
      id: testSessionId,
      tenant_id: testTenantId,
      session_id: testSessionId,
      persistent: false,
      created_at: new Date(),
      last_used_at: new Date(),
      lease_owner: getLeaseOwner(),
      lease_expires_at: new Date(Date.now() + 300000),
    });

    const session = await manager.getOrCreateSession(testTenantId, testSessionId);

    // Verify session was created
    expect(session).toBeDefined();
    expect(session.id).toBe(testSessionId);
    expect(session.tenantId).toBe(testTenantId);

    // Verify database insert was called
    expect(mockPrismaClient.browser_sessions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: testSessionId,
        tenant_id: testTenantId,
        session_id: testSessionId,
        persistent: false,
      }),
    });
  });

  // Test 2: closeSession removes database record
  test('closeSession removes database record', async () => {
    // First create a session
    mockPrismaClient.$queryRaw.mockResolvedValue([]);
    mockPrismaClient.browser_sessions.create.mockResolvedValue({
      id: testSessionId,
      tenant_id: testTenantId,
      session_id: testSessionId,
      persistent: false,
      created_at: new Date(),
      last_used_at: new Date(),
      lease_owner: getLeaseOwner(),
      lease_expires_at: new Date(Date.now() + 300000),
    });

    await manager.getOrCreateSession(testTenantId, testSessionId);

    // Mock successful delete
    mockPrismaClient.browser_sessions.delete.mockResolvedValue({
      id: testSessionId,
    });

    // Close the session
    const closed = await manager.closeSession(testTenantId, testSessionId);

    expect(closed).toBe(true);
    expect(mockPrismaClient.browser_sessions.delete).toHaveBeenCalledWith({
      where: { id: testSessionId },
    });
  });

  // Test 3: Orphaned database records cleaned up on startup
  test('orphaned database records cleaned up on startup', async () => {
    // Mock orphaned sessions with expired leases
    const orphanedRecords = [
      {
        id: 'orphan-1',
        tenant_id: 'tenant-old',
        session_id: 'sess_old1',
        lease_expires_at: new Date(Date.now() - 60000), // expired
      },
      {
        id: 'orphan-2',
        tenant_id: 'tenant-old',
        session_id: 'sess_old2',
        lease_expires_at: new Date(Date.now() - 120000), // expired
      },
    ];

    mockPrismaClient.browser_sessions.findMany.mockResolvedValue(orphanedRecords);
    mockPrismaClient.browser_sessions.deleteMany.mockResolvedValue({ count: 2 });

    // Start manager - should clean up orphans
    manager.start();

    // Wait for async cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify orphaned records were queried
    expect(mockPrismaClient.browser_sessions.findMany).toHaveBeenCalledWith({
      where: {
        lease_expires_at: {
          lt: expect.any(Date),
        },
      },
    });

    // Verify orphaned records were deleted
    expect(mockPrismaClient.browser_sessions.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['orphan-1', 'orphan-2'],
        },
      },
    });
  });

  // Test 4: Lease pattern - lease owner and expiration set correctly
  test('lease owner and expiration set correctly on session creation', async () => {
    mockPrismaClient.$queryRaw.mockResolvedValue([]);
    mockPrismaClient.browser_sessions.create.mockImplementation((args) => {
      return Promise.resolve({
        ...args.data,
        created_at: new Date(),
        last_used_at: new Date(),
      });
    });

    await manager.getOrCreateSession(testTenantId, testSessionId);

    // Verify lease details
    expect(mockPrismaClient.browser_sessions.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lease_owner: getLeaseOwner(),
        lease_expires_at: expect.any(Date),
      }),
    });

    // Verify lease expiration is ~5 minutes in the future
    const createCall = mockPrismaClient.browser_sessions.create.mock.calls[0][0];
    const leaseExpiresAt = createCall.data.lease_expires_at as Date;
    const expectedExpiry = Date.now() + 300000; // 5 minutes
    expect(leaseExpiresAt.getTime()).toBeGreaterThanOrEqual(expectedExpiry - 1000);
    expect(leaseExpiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry + 1000);
  });
});

describe('Browser Session Lock Key Generation', () => {
  // Test 5: Lock key generation produces consistent, non-colliding keys
  test('generateLockKey produces consistent hash for same tenant+session', () => {
    const key1 = generateLockKey('tenant-abc', 'sess_12345');
    const key2 = generateLockKey('tenant-abc', 'sess_12345');

    expect(key1).toBe(key2);
    expect(typeof key1).toBe('number');
    expect(key1).toBeGreaterThan(0);
  });

  test('generateLockKey produces different keys for different inputs', () => {
    const key1 = generateLockKey('tenant-abc', 'sess_12345');
    const key2 = generateLockKey('tenant-abc', 'sess_67890');
    const key3 = generateLockKey('tenant-xyz', 'sess_12345');

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });
});

describe('Browser Session Lease Owner', () => {
  test('getLeaseOwner returns hostname-pid format', () => {
    const leaseOwner = getLeaseOwner();

    expect(leaseOwner).toContain(os.hostname());
    expect(leaseOwner).toContain(String(process.pid));
    expect(leaseOwner).toMatch(/^.+-\d+$/);
  });
});
