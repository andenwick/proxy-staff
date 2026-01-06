import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser screenshot tool for capturing page or element screenshots.
 * Screenshots are saved to the tenant's folder with tenant isolation.
 */
export const browserScreenshotTool: Tool = {
  name: 'browser_screenshot',
  description:
    'Take a screenshot of the page or a specific element. Screenshots are saved to the tenant\'s folder.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID from browser_open.',
      },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to screenshot a specific element.',
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture the full scrollable page (default false).',
      },
    },
    required: ['sessionId'],
  },
  execute: async (input, context) => {
    const sessionId = input.sessionId as string;
    const selector = input.selector as string | undefined;
    const fullPage = (input.fullPage as boolean) ?? false;

    const startMs = Date.now();

    try {
      // Get session with tenant isolation
      const session = await browserSessionManager.getSession(
        context.tenantId,
        sessionId
      );

      if (!session) {
        incrementCounter('browser_screenshots', { status: 'not_found' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      // Generate timestamp in YYYYMMDD_HHmmss format
      const now = new Date();
      const timestamp = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');

      const filename = `${sessionId}_${timestamp}.png`;

      // Ensure screenshot folder exists
      const screenshotFolder = path.join('tenants', context.tenantId, 'screenshots');
      if (!fs.existsSync(screenshotFolder)) {
        fs.mkdirSync(screenshotFolder, { recursive: true });
      }

      // Build full path
      const screenshotPath = path.join(screenshotFolder, filename);

      // Take screenshot
      if (selector) {
        // Screenshot specific element
        const locator = session.page.locator(selector);

        // Check if element exists
        const count = await locator.count();
        if (count === 0) {
          incrementCounter('browser_screenshots', { status: 'element_not_found' });
          recordTiming('browser_screenshot_ms', Date.now() - startMs, { status: 'element_not_found' });
          return `Error: Could not find element matching '${selector}' to screenshot.`;
        }

        await locator.screenshot({ path: screenshotPath });
      } else {
        // Screenshot full page or viewport
        await session.page.screenshot({ path: screenshotPath, fullPage });
      }

      recordTiming('browser_screenshot_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_screenshots', { status: 'ok' });

      logger.info(
        { tenantId: context.tenantId, sessionId, path: screenshotPath, selector, fullPage },
        'Screenshot captured'
      );

      return `Screenshot saved: ${screenshotPath}`;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_screenshot_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_screenshots', { status: 'error' });

      logger.error(
        { error: err.message, tenantId: context.tenantId, sessionId, selector },
        'Failed to take screenshot'
      );

      return `Error: ${err.message}`;
    }
  },
};
