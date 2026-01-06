/**
 * Browser automation tools using Playwright.
 * Provides tenant-isolated browser sessions for web automation.
 */

import { browserOpenTool } from './browserOpen.js';
import { browserCloseTool } from './browserClose.js';
import { browserListTool } from './browserList.js';
import { browserClickTool } from './browserClick.js';
import { browserTypeTool } from './browserType.js';
import { browserReadTool } from './browserRead.js';
import { browserScreenshotTool } from './browserScreenshot.js';
import { browserWaitTool } from './browserWait.js';
import { browserLoginTool } from './browserLogin.js';

// Export all browser tools
export const browserTools = [
  browserOpenTool,
  browserCloseTool,
  browserListTool,
  browserClickTool,
  browserTypeTool,
  browserReadTool,
  browserScreenshotTool,
  browserWaitTool,
  browserLoginTool,
];

// Re-export individual tools for direct access
export {
  browserOpenTool,
  browserCloseTool,
  browserListTool,
  browserClickTool,
  browserTypeTool,
  browserReadTool,
  browserScreenshotTool,
  browserWaitTool,
  browserLoginTool,
};

// Re-export types
export * from './types.js';
