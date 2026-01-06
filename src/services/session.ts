import { getPrismaClient } from './prisma.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getLeaseOwner } from '../utils/process.js';
import { addSessionEndJob } from './queue/queueService.js';

// Re-export getLeaseOwner for backward compatibility
export { getLeaseOwner } from '../utils/process.js';

// Lease TTL: 5 minutes (300 seconds), consistent with SchedulerService
const LEASE_TTL_SECONDS = 300;

/**
 * Get the session timeout from configuration.
 * Defaults to 24 hours if SESSION_TIMEOUT_HOURS is not set.
 */
export function getSessionTimeoutHours(): number {
  return getConfig().sessionTimeoutHours;
}

/**
 * Get the active session for a tenant+sender, or create a new one.
 * Uses database transaction with row locking to prevent race conditions.
 *
 * A session is active if:
 * - ended_at is NULL
 * - AND has a message within the timeout window (configurable via SESSION_TIMEOUT_HOURS)
 * - AND (no lease OR lease expired)
 *
 * Returns both the sessionId and whether a new session was created.
 */
export async function getOrCreateSession(
  tenantId: string,
  senderPhone: string
): Promise<{ sessionId: string; isNew: boolean }> {
  const prisma = getPrismaClient();
  const timeoutHours = getSessionTimeoutHours();
  const leaseOwner = getLeaseOwner();

  return prisma.$transaction(async (tx) => {
    // Calculate cutoff time based on configurable timeout
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - timeoutHours);

    // Use raw SQL with FOR UPDATE SKIP LOCKED to prevent race conditions
    // This locks the row for the duration of the transaction
    const existingSessions = await tx.$queryRaw<
      Array<{
        id: string;
        tenant_id: string;
        sender_phone: string;
        started_at: Date;
        ended_at: Date | null;
        lease_owner: string | null;
        lease_expires_at: Date | null;
      }>
    >`
      SELECT cs.id, cs.tenant_id, cs.sender_phone, cs.started_at, cs.ended_at,
             cs.lease_owner, cs.lease_expires_at
      FROM conversation_sessions cs
      WHERE cs.tenant_id = ${tenantId}
        AND cs.sender_phone = ${senderPhone}
        AND cs.ended_at IS NULL
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m.session_id = cs.id
            AND m.created_at >= ${cutoffTime}
        )
        AND (cs.lease_expires_at IS NULL OR cs.lease_expires_at < NOW())
      ORDER BY cs.started_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (existingSessions.length > 0) {
      const session = existingSessions[0];

      // Set lease on the session we're claiming
      const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000);
      await tx.conversationSession.update({
        where: { id: session.id },
        data: {
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
        },
      });

      logger.debug(
        { sessionId: session.id, tenantId, leaseOwner },
        'Claimed existing session with lease'
      );

      return { sessionId: session.id, isNew: false };
    }

    // No active session found - end any expired open sessions
    await tx.conversationSession.updateMany({
      where: {
        tenant_id: tenantId,
        sender_phone: senderPhone,
        ended_at: null,
      },
      data: {
        ended_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
      },
    });

    // Create new session with lease
    const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000);
    const newSession = await tx.conversationSession.create({
      data: {
        tenant_id: tenantId,
        sender_phone: senderPhone,
        lease_owner: leaseOwner,
        lease_expires_at: leaseExpiresAt,
      },
    });

    logger.debug(
      { sessionId: newSession.id, tenantId, leaseOwner },
      'Created new session with lease'
    );

    return { sessionId: newSession.id, isNew: true };
  });
}

/**
 * Release the lease on a session after operation completes.
 * Call this after processing is done to allow other instances to claim the session.
 */
export async function releaseSessionLease(sessionId: string): Promise<void> {
  const prisma = getPrismaClient();
  const leaseOwner = getLeaseOwner();

  try {
    await prisma.conversationSession.updateMany({
      where: {
        id: sessionId,
        lease_owner: leaseOwner,
      },
      data: {
        lease_owner: null,
        lease_expires_at: null,
      },
    });

    logger.debug({ sessionId }, 'Released session lease');
  } catch (error) {
    logger.warn({ sessionId, error }, 'Failed to release session lease');
  }
}

/**
 * End a session by setting ended_at timestamp and queue learning trigger job.
 * Queues a job via BullMQ instead of using database polling.
 */
export async function endSession(sessionId: string): Promise<void> {
  const prisma = getPrismaClient();

  // First update the session to set ended_at
  const session = await prisma.conversationSession.update({
    where: { id: sessionId },
    data: {
      ended_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
    },
  });

  // Queue learning job via BullMQ (replaces database insert)
  await addSessionEndJob(sessionId, session.tenant_id, session.sender_phone, 'expiry');

  logger.debug(
    { sessionId, tenantId: session.tenant_id },
    'Ended session and queued learning job'
  );
}

/**
 * Create a new session for a tenant+sender
 */
export async function createSession(
  tenantId: string,
  senderPhone: string
): Promise<string> {
  const prisma = getPrismaClient();
  const leaseOwner = getLeaseOwner();
  const leaseExpiresAt = new Date(Date.now() + LEASE_TTL_SECONDS * 1000);

  const session = await prisma.conversationSession.create({
    data: {
      tenant_id: tenantId,
      sender_phone: senderPhone,
      lease_owner: leaseOwner,
      lease_expires_at: leaseExpiresAt,
    },
  });

  return session.id;
}
