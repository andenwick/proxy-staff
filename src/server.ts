import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { logger } from './utils/logger.js';
import { requestIdPlugin } from './middleware/requestId.js';
import { errorHandlerPlugin } from './middleware/errorHandler.js';
import { healthRoute } from './routes/health.js';
import { metricsRoute } from './routes/metrics.js';
import { whatsappWebhookRoutes, stopDeduplicationCleanup } from './routes/webhooks/whatsapp.js';
import { telegramWebhookRoutes, stopTelegramDeduplicationCleanup } from './routes/webhooks/telegram.js';
import { toolsRoutes } from './routes/tools.js';
import { triggerRoutes } from './routes/triggers.js';
import { webhookTriggerRoute } from './routes/webhooks/trigger.js';
import { eventsRoute } from './routes/events.js';
import { outlookRoutes } from './routes/outlook.js';
import { shutdownServices, getImprovementScheduler, getTriggerEvaluator, getWebhookAdapter } from './services/index.js';
import { getPrismaClient } from './services/prisma.js';

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // We use our own Pino logger
    // Enable raw body access for signature verification (required for HMAC computation)
    bodyLimit: 1048576, // 1MB limit
  });

  // Store raw body for signature verification
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req: FastifyRequest, body: Buffer, done) => {
      // Store raw body on request for signature verification
      req.rawBody = body;
      try {
        const json = JSON.parse(body.toString());
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

  // Register middleware plugins
  await server.register(requestIdPlugin);
  await server.register(errorHandlerPlugin);

  // Inject Prisma and trigger services for routes
  const prisma = getPrismaClient();
  server.decorate('prisma', prisma);

  // Register routes
  await server.register(healthRoute);
  await server.register(metricsRoute);
  await server.register(whatsappWebhookRoutes);
  await server.register(telegramWebhookRoutes);
  await server.register(toolsRoutes);
  await server.register(triggerRoutes);
  await server.register(webhookTriggerRoute);
  await server.register(eventsRoute);
  await server.register(outlookRoutes);

  // Ready hook for logging and service injection
  server.addHook('onReady', async () => {
    // Inject trigger services (after they're initialized)
    try {
      server.triggerEvaluator = getTriggerEvaluator();
      server.webhookAdapter = getWebhookAdapter();
      logger.info('Trigger services injected into server');
    } catch (error) {
      logger.warn({ error }, 'Trigger services not available (may not be initialized)');
    }
    logger.info('Server plugins and routes registered');
  });

  return server;
}

export async function startServer(server: FastifyInstance, port: number, host: string = '0.0.0.0'): Promise<void> {
  // Graceful shutdown handler
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, closing server...');
    try {
      // Stop deduplication cleanup intervals
      stopDeduplicationCleanup();
      stopTelegramDeduplicationCleanup();

      // Shutdown all services (scheduler, CLI, Python, Prisma)
      await shutdownServices();

      await server.close();
      logger.info('Server closed successfully');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during server shutdown');
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Start improvement scheduler (non-critical)
  try {
    const improvementScheduler = getImprovementScheduler();
    improvementScheduler.start();
    logger.info('Improvement scheduler started');
  } catch (error) {
    logger.warn({ error }, 'Failed to start improvement scheduler (non-critical)');
  }

  try {
    await server.listen({ port, host });
    logger.info({ port, host }, `Server listening on ${host}:${port}`);
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    throw err;
  }
}
