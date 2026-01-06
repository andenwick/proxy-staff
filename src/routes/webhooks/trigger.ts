import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger.js';
import type { ExternalWebhookPayload, WebhookHeaders } from '../../types/trigger.js';

/**
 * External webhook receiver route.
 * Receives POST requests from external systems and triggers workflows.
 *
 * Route: POST /webhooks/trigger/:webhookPath
 */
export const webhookTriggerRoute: FastifyPluginAsync = async (fastify) => {
  /**
   * Receive external webhook
   * POST /webhooks/trigger/:webhookPath
   *
   * Responds immediately with 200, processes asynchronously.
   */
  fastify.post<{
    Params: { webhookPath: string };
    Body: ExternalWebhookPayload;
  }>(
    '/webhooks/trigger/:webhookPath',
    async (request: FastifyRequest<{ Params: { webhookPath: string }; Body: ExternalWebhookPayload }>, reply: FastifyReply) => {
      const { webhookPath } = request.params;
      const payload = request.body;

      logger.debug({ webhookPath }, 'Received external webhook');

      // Get webhook adapter from fastify (injected during server setup)
      const webhookAdapter = fastify.webhookAdapter;
      if (!webhookAdapter) {
        logger.error('Webhook adapter not available');
        return reply.status(503).send({ error: 'Service unavailable' });
      }

      // Extract relevant headers
      const headers: WebhookHeaders = {
        'x-signature': request.headers['x-signature'] as string | undefined,
        'x-hub-signature-256': request.headers['x-hub-signature-256'] as string | undefined,
        'x-idempotency-key': request.headers['x-idempotency-key'] as string | undefined,
      };

      // Process webhook (returns immediately, processes async)
      const result = await webhookAdapter.processWebhook(webhookPath, payload, headers);

      if (!result.success) {
        logger.warn({ webhookPath, message: result.message }, 'Webhook processing failed');
        return reply.status(404).send({ error: result.message });
      }

      // Always respond quickly (webhook providers expect fast response)
      return reply.send({ status: 'accepted', message: result.message });
    }
  );
};
