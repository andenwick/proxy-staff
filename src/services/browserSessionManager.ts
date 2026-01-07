import crypto from 'crypto';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { getPrismaClient } from './prisma.js';
import { getLeaseOwner } from '../utils/process.js';

/**
 * Browser session for a tenant
 */
export interface BrowserSession {
  id: string;
  tenantId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastUsedAt: Date;
  persistent: boolean;
}

/**
 * Options for creating a browser session
 */
export interface CreateSessionOptions {
  persistent?: boolean;
}

/**
 * Session info returned from listSessions (without browser internals)
 */
export interface BrowserSessionInfo {
  id: string;
  tenantId: string;
  createdAt: Date;
  lastUsedAt: Date;
  persistent: boolean;
}

// Configuration from environment with defaults
const MAX_SESSIONS_PER_TENANT = parseInt(
  process.env.BROWSER_MAX_SESSIONS_PER_TENANT || '5',
  10
);
const SESSION_IDLE_TTL_MS = parseInt(
  process.env.BROWSER_SESSION_IDLE_TTL_MS || String(30 * 60 * 1000),
  10
); // 30 minutes
const SESSION_PERSIST_TTL_MS = parseInt(
  process.env.BROWSER_SESSION_PERSIST_TTL_MS || String(24 * 60 * 60 * 1000),
  10
); // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds

// Lease TTL: 5 minutes (300 seconds), consistent with SchedulerService
const LEASE_TTL_SECONDS = 300;

// Lock key offset to avoid conflicts with scheduler (uses 1) and conversation sessions (uses 2)
// Note: Using hash-based lock keys instead of primary offset

// Re-export getLeaseOwner for backward compatibility
export { getLeaseOwner } from '../utils/process.js';

/**
 * Generate a lock key from tenant_id + session_id.
 * Uses hash to produce a consistent integer for PostgreSQL advisory locks.
 */
export function generateLockKey(tenantId: string, sessionId: string): number {
  const input = `browser:${tenantId}:${sessionId}`;
  const hash = crypto.createHash('md5').update(input).digest();
  // Use first 4 bytes as a 32-bit integer (PostgreSQL advisory lock key)
  return hash.readUInt32BE(0);
}

/**
 * Generate a session ID in format: sess_ + 8 random alphanumeric chars
 */
function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'sess_';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * BrowserSessionManager - manages browser sessions with tenant isolation
 *
 * Each tenant has their own isolated pool of browser sessions.
 * Sessions are automatically cleaned up based on idle/persist timeouts.
 * Session metadata is persisted to database for reliability across restarts.
 */
export class BrowserSessionManager {
  private sessions: Map<string, Map<string, BrowserSession>> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Start the cleanup interval and clean up orphaned sessions
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('BrowserSessionManager already running');
      return;
    }

    this.isRunning = true;

    // Clean up orphaned database records on startup
    this.cleanupOrphanedDatabaseRecords().catch((err) => {
      logger.error({ err }, 'Error during orphan cleanup on startup');
    });

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredSessions().catch((err) => {
        logger.error({ err }, 'Error during browser session cleanup');
      });
    }, CLEANUP_INTERVAL_MS);

    logger.info(
      {
        maxSessionsPerTenant: MAX_SESSIONS_PER_TENANT,
        idleTtlMs: SESSION_IDLE_TTL_MS,
        persistTtlMs: SESSION_PERSIST_TTL_MS,
        cleanupIntervalMs: CLEANUP_INTERVAL_MS,
        leaseTtlSeconds: LEASE_TTL_SECONDS,
      },
      'BrowserSessionManager started'
    );
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    this.isRunning = false;
    logger.info('BrowserSessionManager stopped');
  }

  /**
   * Get existing session or create a new one
   */
  async getOrCreateSession(
    tenantId: string,
    sessionId?: string,
    options?: CreateSessionOptions
  ): Promise<BrowserSession> {
    const actualSessionId = sessionId || generateSessionId();

    // If sessionId provided, try to get existing session
    if (sessionId) {
      const existing = await this.getSession(tenantId, sessionId);
      if (existing) {
        return existing;
      }
    }

    // Create new session
    return this.createSession(tenantId, actualSessionId, options);
  }

  /**
   * Get a specific session by tenant and session ID
   * Returns null if not found or session is unhealthy
   */
  async getSession(
    tenantId: string,
    sessionId: string
  ): Promise<BrowserSession | null> {
    const tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions) {
      return null;
    }

    const session = tenantSessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Check if browser is still healthy
    const isHealthy = await this.isSessionHealthy(session);
    if (!isHealthy) {
      logger.warn(
        { tenantId, sessionId },
        'Browser session unhealthy, cleaning up'
      );
      await this.closeSession(tenantId, sessionId);
      return null;
    }

    // Update last used time in memory and database
    session.lastUsedAt = new Date();
    await this.updateLastUsedAt(sessionId, session.lastUsedAt);

    return session;
  }

  /**
   * Close and cleanup a specific session
   */
  async closeSession(tenantId: string, sessionId: string): Promise<boolean> {
    const tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions) {
      return false;
    }

    const session = tenantSessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Close browser resources
    try {
      await session.page.close().catch(() => {});
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    } catch (err) {
      logger.warn({ err, tenantId, sessionId }, 'Error closing browser session');
    }

    tenantSessions.delete(sessionId);

    // Clean up empty tenant map
    if (tenantSessions.size === 0) {
      this.sessions.delete(tenantId);
    }

    // Delete from database
    await this.deleteDatabaseRecord(sessionId);

    logger.info({ tenantId, sessionId }, 'Browser session closed');
    return true;
  }

  /**
   * List all sessions for a tenant (without browser internals)
   */
  listSessions(tenantId: string): BrowserSessionInfo[] {
    const tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions) {
      return [];
    }

    return Array.from(tenantSessions.values()).map((session) => ({
      id: session.id,
      tenantId: session.tenantId,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      persistent: session.persistent,
    }));
  }

  /**
   * Close all sessions (for graceful shutdown)
   */
  async closeAllSessions(): Promise<void> {
    logger.info('Closing all browser sessions');

    const closePromises: Promise<boolean>[] = [];

    for (const [tenantId, tenantSessions] of this.sessions) {
      for (const sessionId of tenantSessions.keys()) {
        closePromises.push(this.closeSession(tenantId, sessionId));
      }
    }

    await Promise.all(closePromises);
    logger.info('All browser sessions closed');
  }

  /**
   * Get the count of sessions for a tenant
   */
  getSessionCount(tenantId: string): number {
    const tenantSessions = this.sessions.get(tenantId);
    return tenantSessions ? tenantSessions.size : 0;
  }

  /**
   * Close the oldest idle (non-persistent) session for a tenant
   * Returns true if a session was closed, false if none available to close
   */
  private async closeOldestIdleSession(tenantId: string): Promise<boolean> {
    const tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions || tenantSessions.size === 0) {
      return false;
    }

    // Find oldest non-persistent session by lastUsedAt
    let oldestSession: BrowserSession | null = null;
    for (const session of tenantSessions.values()) {
      if (!session.persistent) {
        if (!oldestSession || session.lastUsedAt < oldestSession.lastUsedAt) {
          oldestSession = session;
        }
      }
    }

    if (oldestSession) {
      logger.info(
        { tenantId, sessionId: oldestSession.id, idleMs: Date.now() - oldestSession.lastUsedAt.getTime() },
        'Closing oldest idle session to make room for new session'
      );
      await this.closeSession(tenantId, oldestSession.id);
      return true;
    }

    return false;
  }

  /**
   * Create a new browser session
   */
  private async createSession(
    tenantId: string,
    sessionId: string,
    options?: CreateSessionOptions
  ): Promise<BrowserSession> {
    // Check session limit - if reached, close oldest idle session first
    const currentCount = this.getSessionCount(tenantId);
    if (currentCount >= MAX_SESSIONS_PER_TENANT) {
      const closed = await this.closeOldestIdleSession(tenantId);
      if (!closed) {
        const errorMsg = `Session limit reached for tenant ${tenantId}. Maximum ${MAX_SESSIONS_PER_TENANT} sessions allowed.`;
        logger.error({ tenantId, currentCount, limit: MAX_SESSIONS_PER_TENANT }, errorMsg);
        throw new Error(errorMsg);
      }
    }

    logger.info({ tenantId, sessionId }, 'Creating new browser session');

    const now = new Date();
    const persistent = options?.persistent ?? false;
    const leaseOwner = getLeaseOwner();
    const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000);

    // Insert database record first (with lease)
    await this.createDatabaseRecord(sessionId, tenantId, persistent, now, leaseOwner, leaseExpiresAt);

    // Launch browser
    // Use system chromium in Docker via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // Create isolated context
    const context = await browser.newContext();

    // Create page
    const page = await context.newPage();

    const session: BrowserSession = {
      id: sessionId,
      tenantId,
      browser,
      context,
      page,
      createdAt: now,
      lastUsedAt: now,
      persistent,
    };

    // Store session in memory
    let tenantSessions = this.sessions.get(tenantId);
    if (!tenantSessions) {
      tenantSessions = new Map();
      this.sessions.set(tenantId, tenantSessions);
    }
    tenantSessions.set(sessionId, session);

    logger.info(
      { tenantId, sessionId, persistent: session.persistent, leaseOwner },
      'Browser session created'
    );

    return session;
  }

  /**
   * Check if a session's browser is still healthy
   */
  private async isSessionHealthy(session: BrowserSession): Promise<boolean> {
    try {
      // Try a simple evaluation to check if page is responsive
      await session.page.evaluate(() => true);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up expired sessions (in-memory and database sync)
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const sessionsToClose: Array<{ tenantId: string; sessionId: string }> = [];

    for (const [tenantId, tenantSessions] of this.sessions) {
      for (const [sessionId, session] of tenantSessions) {
        const idleTime = now - session.lastUsedAt.getTime();
        const totalTime = now - session.createdAt.getTime();

        // Check idle timeout for non-persistent sessions
        if (!session.persistent && idleTime > SESSION_IDLE_TTL_MS) {
          logger.info(
            { tenantId, sessionId, idleTimeMs: idleTime },
            'Session expired due to idle timeout'
          );
          sessionsToClose.push({ tenantId, sessionId });
          continue;
        }

        // Check persist timeout for persistent sessions
        if (session.persistent && totalTime > SESSION_PERSIST_TTL_MS) {
          logger.info(
            { tenantId, sessionId, totalTimeMs: totalTime },
            'Persistent session expired due to max TTL'
          );
          sessionsToClose.push({ tenantId, sessionId });
          continue;
        }

        // Also check health during cleanup
        const isHealthy = await this.isSessionHealthy(session);
        if (!isHealthy) {
          logger.warn(
            { tenantId, sessionId },
            'Session marked for cleanup due to unhealthy browser'
          );
          sessionsToClose.push({ tenantId, sessionId });
        }
      }
    }

    // Close expired sessions
    for (const { tenantId, sessionId } of sessionsToClose) {
      await this.closeSession(tenantId, sessionId);
    }

    if (sessionsToClose.length > 0) {
      logger.info(
        { closedCount: sessionsToClose.length },
        'Cleanup completed'
      );
    }

    // Sync with database: remove orphaned database records
    await this.syncDatabaseWithMemory();
  }

  /**
   * Clean up orphaned database records on startup.
   * Records with expired leases and no corresponding in-memory session are deleted.
   */
  private async cleanupOrphanedDatabaseRecords(): Promise<void> {
    try {
      const prisma = getPrismaClient();
      const now = new Date();

      // Find records with expired leases
      const orphanedRecords = await prisma.browser_sessions.findMany({
        where: {
          lease_expires_at: {
            lt: now,
          },
        },
      });

      if (orphanedRecords.length === 0) {
        logger.debug('No orphaned browser session records found on startup');
        return;
      }

      const orphanIds = orphanedRecords.map((r) => r.id);

      // Delete orphaned records
      const result = await prisma.browser_sessions.deleteMany({
        where: {
          id: {
            in: orphanIds,
          },
        },
      });

      logger.info(
        { count: result.count, ids: orphanIds },
        'Cleaned up orphaned browser session records on startup'
      );
    } catch (err) {
      logger.error({ err }, 'Failed to clean up orphaned browser session records');
    }
  }

  /**
   * Sync database records with in-memory state.
   * Removes database records that don't have a corresponding in-memory session.
   */
  private async syncDatabaseWithMemory(): Promise<void> {
    try {
      const prisma = getPrismaClient();
      const leaseOwner = getLeaseOwner();

      // Get all database records owned by this instance
      const dbRecords = await prisma.browser_sessions.findMany({
        where: {
          lease_owner: leaseOwner,
        },
        select: {
          id: true,
          tenant_id: true,
        },
      });

      const orphanedIds: string[] = [];

      for (const record of dbRecords) {
        const tenantSessions = this.sessions.get(record.tenant_id);
        const hasInMemory = tenantSessions?.has(record.id) ?? false;

        if (!hasInMemory) {
          orphanedIds.push(record.id);
        }
      }

      if (orphanedIds.length > 0) {
        await prisma.browser_sessions.deleteMany({
          where: {
            id: {
              in: orphanedIds,
            },
          },
        });

        logger.info(
          { count: orphanedIds.length },
          'Synced database: removed orphaned records'
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to sync database with in-memory state');
    }
  }

  /**
   * Create a database record for a browser session
   */
  private async createDatabaseRecord(
    sessionId: string,
    tenantId: string,
    persistent: boolean,
    createdAt: Date,
    leaseOwner: string,
    leaseExpiresAt: Date
  ): Promise<void> {
    try {
      const prisma = getPrismaClient();
      await prisma.browser_sessions.create({
        data: {
          id: sessionId,
          tenant_id: tenantId,
          session_id: sessionId,
          persistent,
          created_at: createdAt,
          last_used_at: createdAt,
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
        },
      });
    } catch (err) {
      logger.error({ err, sessionId, tenantId }, 'Failed to create database record for browser session');
      throw err;
    }
  }

  /**
   * Update last_used_at timestamp in database
   */
  private async updateLastUsedAt(sessionId: string, lastUsedAt: Date): Promise<void> {
    try {
      const prisma = getPrismaClient();
      await prisma.browser_sessions.update({
        where: { id: sessionId },
        data: {
          last_used_at: lastUsedAt,
          lease_expires_at: new Date(Date.now() + LEASE_TTL_SECONDS * 1000),
        },
      });
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to update last_used_at for browser session');
    }
  }

  /**
   * Delete database record for a browser session
   */
  private async deleteDatabaseRecord(sessionId: string): Promise<void> {
    try {
      const prisma = getPrismaClient();
      await prisma.browser_sessions.delete({
        where: { id: sessionId },
      });
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to delete database record for browser session');
    }
  }
}

// Export singleton instance
export const browserSessionManager = new BrowserSessionManager();
