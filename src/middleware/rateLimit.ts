import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../utils/logger.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory rate limit store
// Key: identifier (phone number or chat ID), Value: request count and reset time
const rateLimitStore = new Map<string, RateLimitEntry>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 60; // 60 requests per minute
const CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute
const MAX_ENTRIES = 10000; // Maximum entries to prevent memory bloat

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetAt) {
        rateLimitStore.delete(key);
      }
    }
    // Prevent memory bloat
    if (rateLimitStore.size > MAX_ENTRIES) {
      const entries = Array.from(rateLimitStore.entries())
        .sort((a, b) => a[1].resetAt - b[1].resetAt);
      const toRemove = entries.slice(0, rateLimitStore.size - MAX_ENTRIES);
      for (const [key] of toRemove) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

export function stopRateLimitCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Extract identifier from webhook request body
 * Returns phone number for WhatsApp, chat ID for Telegram
 */
function extractIdentifier(request: FastifyRequest): string | null {
  const body = request.body as Record<string, unknown>;

  // Telegram: extract chat.id from message
  if (body?.message && typeof body.message === 'object') {
    const msg = body.message as Record<string, unknown>;
    if (msg.chat && typeof msg.chat === 'object') {
      const chat = msg.chat as Record<string, unknown>;
      if (chat.id) return `telegram:${chat.id}`;
    }
  }

  // WhatsApp: extract phone from entry.changes.value.messages
  if (body?.entry && Array.isArray(body.entry)) {
    const entry = body.entry[0] as Record<string, unknown>;
    if (entry?.changes && Array.isArray(entry.changes)) {
      const change = entry.changes[0] as Record<string, unknown>;
      if (change?.value && typeof change.value === 'object') {
        const value = change.value as Record<string, unknown>;
        if (value?.messages && Array.isArray(value.messages)) {
          const msg = value.messages[0] as Record<string, unknown>;
          if (msg?.from) return `whatsapp:${msg.from}`;
        }
      }
    }
  }

  return null;
}

/**
 * Check if request should be rate limited
 * Returns true if within limit, false if exceeded
 */
function checkRateLimit(identifier: string): { allowed: boolean; remaining: number; resetAt: number } {
  if (!cleanupInterval) {
    startCleanup();
  }

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    // New window
    rateLimitStore.set(identifier, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, resetAt: entry.resetAt };
}

const rateLimitPluginAsync: FastifyPluginAsync = async (fastify) => {
  // Only apply to webhook routes
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only rate limit webhook endpoints
    if (!request.url.startsWith('/webhooks/')) {
      return;
    }

    // Skip GET requests (verification endpoints)
    if (request.method === 'GET') {
      return;
    }

    const identifier = extractIdentifier(request);
    if (!identifier) {
      // Can't identify sender, allow through (will be handled by other validation)
      return;
    }

    const { allowed, remaining, resetAt } = checkRateLimit(identifier);

    // Set rate limit headers
    reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

    if (!allowed) {
      logger.warn({ identifier, resetAt }, 'Rate limit exceeded');
      reply.code(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please slow down.',
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      });
      return reply;
    }
  });
};

export const rateLimitPlugin = fp(rateLimitPluginAsync, {
  name: 'rate-limit-plugin',
});
