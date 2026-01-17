import { getConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { buildServer, startServer } from './server.js';
import { initializeServices, shutdownServices, getToolHealthService } from './services/index.js';

// Global error handlers for uncaught exceptions
process.on('uncaughtException', async (error: Error) => {
  logger.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception - shutting down');
  try {
    await shutdownServices();
  } catch (shutdownError) {
    logger.error({ error: shutdownError }, 'Error during emergency shutdown');
  }
  process.exit(1);
});

process.on('unhandledRejection', async (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.fatal({ reason: message, stack }, 'Unhandled promise rejection - shutting down');
  try {
    await shutdownServices();
  } catch (shutdownError) {
    logger.error({ error: shutdownError }, 'Error during emergency shutdown');
  }
  process.exit(1);
});

async function main(): Promise<void> {
  try {
    // Load and validate config (will throw if missing required env vars)
    const config = getConfig();
    logger.info({ nodeEnv: config.nodeEnv }, 'Configuration loaded successfully');

    // Initialize services (Claude, WhatsApp, message processor)
    initializeServices();
    logger.info('Services initialized');

    // Build and start server
    const server = await buildServer();
    await startServer(server, config.port);

    // Schedule initial tool health check 30 seconds after startup
    logger.info('Initial health checks scheduled (30s after startup)');
    setTimeout(async () => {
      const toolHealthService = getToolHealthService();

      // Run tool health check
      logger.info('Running initial tool health check');
      try {
        const toolResult = await toolHealthService.runFullSuite();
        logger.info(
          { passed: toolResult.passed, failed: toolResult.failed, skipped: toolResult.skipped },
          'Initial tool health check completed'
        );
      } catch (error) {
        logger.error({ error }, 'Initial tool health check failed');
      }

      // Run credential check
      logger.info('Running initial credential check');
      try {
        const credResult = await toolHealthService.runCredentialChecks();
        logger.info(
          { valid: credResult.valid, invalid: credResult.invalid, skipped: credResult.skipped },
          'Initial credential check completed'
        );
      } catch (error) {
        logger.error({ error }, 'Initial credential check failed');
      }
    }, 30000);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start application');
    process.exit(1);
  }
}

// Start application
main();
