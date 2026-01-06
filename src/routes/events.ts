import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { eventBus } from '../services/eventBus.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import type { InternalEventType, InternalEvent } from '../types/trigger.js';

// Type augmentations are in src/types/fastify.d.ts

interface InternalEventPayload {
  type: InternalEventType;
  data: unknown;
}

/**
 * Internal event bus route.
 * Allows internal services (email processor, etc.) to emit events.
 *
 * Route: POST /api/events
 */
export const eventsRoute: FastifyPluginAsync = async (fastify) => {
  /**
   * Emit an internal event
   * POST /api/events
   *
   * Used by internal services to trigger workflows.
   * Requires tenant authentication.
   */
  fastify.post<{ Body: InternalEventPayload }>(
    '/api/events',
    async (request: FastifyRequest<{ Body: InternalEventPayload }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;

      if (!tenantId) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const { type, data } = request.body;

      if (!type) {
        throw new AppError('Event type required', 'VALIDATION_ERROR', 400);
      }

      // Validate event type
      const validTypes: InternalEventType[] = [
        'message.received',
        'message.sent',
        'task.completed',
        'task.failed',
        'session.created',
        'session.ended',
        'email.received',
      ];

      if (!validTypes.includes(type)) {
        throw new AppError(`Invalid event type: ${type}`, 'VALIDATION_ERROR', 400);
      }

      // Create and emit event
      const event: InternalEvent = {
        type,
        tenantId,
        data,
        timestamp: new Date(),
      };

      eventBus.emitEvent(event);

      logger.debug({ tenantId, eventType: type }, 'Internal event emitted');
      return reply.send({ success: true, event_type: type });
    }
  );

  /**
   * Get supported event types
   * GET /api/events/types
   */
  fastify.get('/api/events/types', async (_request: FastifyRequest, reply: FastifyReply) => {
    const types: { type: InternalEventType; description: string }[] = [
      { type: 'message.received', description: 'A WhatsApp message was received' },
      { type: 'message.sent', description: 'A WhatsApp message was sent' },
      { type: 'task.completed', description: 'A scheduled task completed successfully' },
      { type: 'task.failed', description: 'A scheduled task failed' },
      { type: 'session.created', description: 'A new conversation session started' },
      { type: 'session.ended', description: 'A conversation session ended' },
      { type: 'email.received', description: 'An email was received (from Gmail polling)' },
    ];

    return reply.send(types);
  });
};
