import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser type tool for typing text into input fields.
 * Uses CSS selectors to identify the target input element.
 */
export const browserTypeTool: Tool = {
  name: 'browser_type',
  description:
    'Type text into an input field. Use CSS selectors to identify the input (e.g., \'input[name="email"]\', \'#password\', \'[type="text"]\').',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID from browser_open.',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for the input element.',
      },
      text: {
        type: 'string',
        description: 'Text to type into the input.',
      },
      clear: {
        type: 'boolean',
        description: 'Clear existing text first (default true).',
      },
    },
    required: ['sessionId', 'selector', 'text'],
  },
  execute: async (input, context) => {
    const sessionId = input.sessionId as string;
    const selector = input.selector as string;
    const text = input.text as string;
    const clear = input.clear !== false; // Default to true

    const startMs = Date.now();

    try {
      // Get browser session with tenant isolation
      const session = await browserSessionManager.getSession(
        context.tenantId,
        sessionId
      );

      if (!session) {
        recordTiming('browser_type_ms', Date.now() - startMs, { status: 'error' });
        incrementCounter('browser_types', { status: 'error' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      // Type text into the input element
      if (clear) {
        // fill() clears existing text and types new text
        await session.page.fill(selector, text);
      } else {
        // type() appends text without clearing
        await session.page.type(selector, text);
      }

      recordTiming('browser_type_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_types', { status: 'ok' });

      return `Typed text into '${selector}'${clear ? ' (cleared first)' : ' (appended)'}.`;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_type_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_types', { status: 'error' });

      // Handle element not found errors
      if (
        err.message.includes('waiting for selector') ||
        err.message.includes('failed to find element') ||
        err.message.includes('No element matches selector')
      ) {
        logger.error(
          { error: err.message, selector, tenantId: context.tenantId },
          'Input element not found'
        );
        return `Error: Could not find input element matching '${selector}'.`;
      }

      logger.error(
        { error: err.message, selector, tenantId: context.tenantId },
        'Failed to type text'
      );
      return `Error: ${err.message}`;
    }
  },
};
