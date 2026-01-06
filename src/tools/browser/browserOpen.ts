import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser open tool for navigating to URLs.
 * Creates or reuses browser sessions with tenant isolation.
 */
export const browserOpenTool: Tool = {
  name: 'browser_open',
  description:
    'Open a browser and navigate to a URL. Returns a session ID to use with other browser tools. Use persist=true to keep the session open longer (24h vs 30min default).',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to.',
      },
      sessionId: {
        type: 'string',
        description: 'Optional session ID to reuse an existing browser session.',
      },
      persist: {
        type: 'boolean',
        description:
          'Set to true to keep the session open longer (24 hours instead of 30 minutes).',
      },
    },
    required: ['url'],
  },
  execute: async (input, context) => {
    const url = input.url as string;
    const sessionId = input.sessionId as string | undefined;
    const persist = input.persist as boolean | undefined;

    const startMs = Date.now();

    try {
      // Get or create browser session with tenant isolation
      const session = await browserSessionManager.getOrCreateSession(
        context.tenantId,
        sessionId,
        { persistent: persist }
      );

      // Navigate to URL with 30 second timeout
      await session.page.goto(url, {
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      });

      // Get page title
      const title = await session.page.title();

      recordTiming('browser_navigation_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_navigations', { status: 'ok' });

      return `Opened ${url}\nSession ID: ${session.id}\nPage title: ${title}`;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_navigation_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_navigations', { status: 'error' });

      // Handle specific error cases
      if (err.message.includes('Session limit reached')) {
        logger.error({ error: err.message, tenantId: context.tenantId }, 'Browser session limit reached');
        return 'Error: Maximum browser sessions reached (5). Close some sessions first using browser_close.';
      }

      if (err.message.includes('Timeout') || err.name === 'TimeoutError') {
        logger.error({ error: err.message, url }, 'Browser navigation timeout');
        return 'Error: Page took too long to load.';
      }

      logger.error({ error: err.message, url }, 'Failed to open browser');
      return `Error: ${err.message}`;
    }
  },
};
