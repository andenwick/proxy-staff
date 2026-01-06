import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser wait tool - wait for elements, navigation, or time delays.
 */
export const browserWaitTool: Tool = {
  name: 'browser_wait',
  description:
    'Wait for a condition before proceeding. Use this when you need to wait for an element to appear, a page to load, or a specific amount of time. Types: "selector" waits for element, "navigation" waits for page load, "timeout" waits for specified milliseconds.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID from browser_open',
      },
      type: {
        type: 'string',
        enum: ['selector', 'navigation', 'timeout'],
        description:
          'What to wait for: "selector" (element), "navigation" (page load), "timeout" (fixed delay)',
      },
      value: {
        type: 'string',
        description:
          'For selector: CSS selector. For navigation: URL pattern (optional). For timeout: milliseconds.',
      },
      timeout: {
        type: 'number',
        description: 'Maximum wait time in milliseconds (default: 30000)',
      },
      state: {
        type: 'string',
        enum: ['attached', 'detached', 'visible', 'hidden'],
        description:
          'For selector type: element state to wait for (default: "visible")',
      },
    },
    required: ['sessionId', 'type'],
  },
  execute: async (input, context) => {
    const startMs = Date.now();
    const sessionId = input.sessionId as string;
    const waitType = input.type as 'selector' | 'navigation' | 'timeout';
    const value = input.value as string | undefined;
    const timeout = (input.timeout as number) || 30000;
    const state = (input.state as 'attached' | 'detached' | 'visible' | 'hidden') || 'visible';

    try {
      const session = await browserSessionManager.getSession(context.tenantId, sessionId);

      if (!session) {
        incrementCounter('browser_waits', { status: 'not_found' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      let result: string;

      switch (waitType) {
        case 'selector': {
          if (!value) {
            return 'Error: CSS selector required for "selector" wait type.';
          }
          await session.page.waitForSelector(value, { timeout, state });
          result = `Element "${value}" is now ${state}.`;
          break;
        }

        case 'navigation': {
          if (value) {
            // Wait for specific URL pattern
            await session.page.waitForURL(value, { timeout });
            result = `Navigated to URL matching "${value}".`;
          } else {
            // Wait for any navigation to complete
            await session.page.waitForLoadState('networkidle', { timeout });
            result = 'Page load complete (network idle).';
          }
          break;
        }

        case 'timeout': {
          const delayMs = value ? parseInt(value, 10) : 1000;
          if (isNaN(delayMs) || delayMs < 0) {
            return 'Error: Invalid timeout value. Provide milliseconds as a number.';
          }
          if (delayMs > 60000) {
            return 'Error: Maximum timeout is 60000ms (1 minute).';
          }
          await session.page.waitForTimeout(delayMs);
          result = `Waited ${delayMs}ms.`;
          break;
        }

        default:
          return `Error: Unknown wait type "${waitType}". Use "selector", "navigation", or "timeout".`;
      }

      recordTiming('browser_wait_ms', Date.now() - startMs, { status: 'ok', type: waitType });
      incrementCounter('browser_waits', { status: 'ok', type: waitType });

      return result;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_wait_ms', Date.now() - startMs, { status: 'error', type: waitType });
      incrementCounter('browser_waits', { status: 'error', type: waitType });

      logger.error(
        { tenantId: context.tenantId, sessionId, waitType, error: err.message },
        'Browser wait failed'
      );

      if (err.message.includes('Timeout')) {
        return `Error: Wait timed out after ${timeout}ms. The condition was not met.`;
      }

      return `Error: ${err.message}`;
    }
  },
};
