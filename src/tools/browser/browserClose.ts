import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser close tool for closing browser sessions.
 * Frees up resources when done with a browser session.
 */
export const browserCloseTool: Tool = {
  name: 'browser_close',
  description:
    'Close a browser session. Use this when you are done with a browser session to free up resources.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID to close.',
      },
    },
    required: ['sessionId'],
  },
  execute: async (input, context) => {
    const sessionId = input.sessionId as string;

    try {
      // Close the session with tenant isolation
      const closed = await browserSessionManager.closeSession(
        context.tenantId,
        sessionId
      );

      if (closed) {
        incrementCounter('browser_sessions_closed', { status: 'ok' });
        logger.info(
          { tenantId: context.tenantId, sessionId },
          'Browser session closed via tool'
        );
        return `Session ${sessionId} closed successfully.`;
      } else {
        incrementCounter('browser_sessions_closed', { status: 'not_found' });
        return `Session ${sessionId} not found or already closed.`;
      }
    } catch (error) {
      const err = error as Error;
      incrementCounter('browser_sessions_closed', { status: 'error' });
      logger.error(
        { error: err.message, tenantId: context.tenantId, sessionId },
        'Failed to close browser session'
      );
      return `Error: ${err.message}`;
    }
  },
};
