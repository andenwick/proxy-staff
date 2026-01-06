import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser click tool for clicking elements on a page.
 * Uses CSS selectors to identify elements.
 */
export const browserClickTool: Tool = {
  name: 'browser_click',
  description:
    'Click an element on the page. Use CSS selectors to identify the element (e.g., \'button.submit\', \'#login-btn\', \'[data-testid="submit"]\').',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session ID from browser_open.',
      },
      selector: {
        type: 'string',
        description: 'CSS selector for element to click.',
      },
      timeout: {
        type: 'number',
        description: 'Max wait time in milliseconds (default 30000).',
      },
    },
    required: ['sessionId', 'selector'],
  },
  execute: async (input, context) => {
    const sessionId = input.sessionId as string;
    const selector = input.selector as string;
    const timeout = (input.timeout as number | undefined) ?? 30000;

    const startMs = Date.now();

    try {
      // Get existing session with tenant isolation
      const session = await browserSessionManager.getSession(
        context.tenantId,
        sessionId
      );

      if (!session) {
        incrementCounter('browser_clicks', { status: 'error' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      // Click the element - Playwright auto-waits for visible and clickable
      await session.page.click(selector, { timeout });

      recordTiming('browser_click_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_clicks', { status: 'ok' });

      return `Clicked element matching '${selector}'.`;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_click_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_clicks', { status: 'error' });

      // Handle element not found / timeout
      if (
        err.message.includes('Timeout') ||
        err.name === 'TimeoutError' ||
        err.message.includes('waiting for') ||
        err.message.includes('selector')
      ) {
        logger.error(
          { error: err.message, selector, sessionId, tenantId: context.tenantId },
          'Browser click element not found'
        );
        return `Error: Could not find element matching '${selector}'. Make sure the selector is correct and the element exists on the page.`;
      }

      logger.error(
        { error: err.message, selector, sessionId, tenantId: context.tenantId },
        'Failed to click browser element'
      );
      return `Error: ${err.message}`;
    }
  },
};
