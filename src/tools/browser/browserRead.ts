import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Maximum characters to return from page content.
 * Longer content will be truncated.
 */
const MAX_CONTENT_LENGTH = 10000;

/**
 * Browser read tool for extracting text content from pages.
 * Can read entire page body or specific elements via CSS selectors.
 */
export const browserReadTool: Tool = {
  name: 'browser_read',
  description:
    'Read text content from the page. Optionally specify a CSS selector to read from a specific element, or read the entire page body.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID from browser_open.',
      },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to read from a specific element. Reads body if omitted.',
      },
      attribute: {
        type: 'string',
        description: 'Optional attribute to read instead of text content (e.g., "href", "value").',
      },
    },
    required: ['sessionId'],
  },
  execute: async (input, context) => {
    const sessionId = input.sessionId as string;
    const selector = input.selector as string | undefined;
    const attribute = input.attribute as string | undefined;

    const startMs = Date.now();

    try {
      // Get session with tenant isolation
      const session = await browserSessionManager.getSession(
        context.tenantId,
        sessionId
      );

      if (!session) {
        incrementCounter('browser_reads', { status: 'not_found' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      let content: string | null = null;
      const targetSelector = selector || 'body';

      try {
        if (attribute) {
          // Read attribute value
          content = await session.page.getAttribute(targetSelector, attribute);
        } else {
          // Read text content
          content = await session.page.textContent(targetSelector);
        }
      } catch (elementError) {
        const elemErr = elementError as Error;
        // Check if element was not found
        if (
          elemErr.message.includes('failed to find') ||
          elemErr.message.includes('selector resolved to') ||
          elemErr.message.includes('waiting for selector')
        ) {
          recordTiming('browser_read_ms', Date.now() - startMs, { status: 'not_found' });
          incrementCounter('browser_reads', { status: 'not_found' });
          return `Error: Could not find element matching '${targetSelector}'.`;
        }
        throw elementError;
      }

      if (content === null || content === '') {
        recordTiming('browser_read_ms', Date.now() - startMs, { status: 'empty' });
        incrementCounter('browser_reads', { status: 'empty' });
        return 'No text content found.';
      }

      // Truncate long content
      let result = content.trim();
      let truncated = false;
      if (result.length > MAX_CONTENT_LENGTH) {
        result = result.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
        truncated = true;
      }

      recordTiming('browser_read_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_reads', { status: 'ok' });

      logger.info(
        {
          tenantId: context.tenantId,
          sessionId,
          selector: targetSelector,
          attribute,
          contentLength: content.length,
          truncated,
        },
        'Browser content read'
      );

      return result;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_read_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_reads', { status: 'error' });

      logger.error(
        { error: err.message, tenantId: context.tenantId, sessionId, selector },
        'Failed to read browser content'
      );
      return `Error: ${err.message}`;
    }
  },
};
