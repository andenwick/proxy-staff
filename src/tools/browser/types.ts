/**
 * Browser tool type definitions.
 * Types for browser automation tools in the multi-tenant system.
 */

/**
 * Information about an active browser session.
 */
export interface BrowserSessionInfo {
  id: string;
  url: string;
  title: string;
  createdAt: Date;
  lastUsedAt: Date;
  persistent: boolean;
}

/**
 * Input for browser_open tool.
 */
export interface BrowserOpenInput {
  url: string;
  sessionId?: string;
  persist?: boolean;
}

/**
 * Input for browser_click tool.
 */
export interface BrowserClickInput {
  sessionId: string;
  selector: string;
  timeout?: number;
}

/**
 * Input for browser_type tool.
 */
export interface BrowserTypeInput {
  sessionId: string;
  selector: string;
  text: string;
  clear?: boolean;
}

/**
 * Input for browser_read tool.
 */
export interface BrowserReadInput {
  sessionId: string;
  selector?: string;
  attribute?: string;
}

/**
 * Input for browser_screenshot tool.
 */
export interface BrowserScreenshotInput {
  sessionId: string;
  selector?: string;
  fullPage?: boolean;
}

/**
 * Input for browser_close tool.
 */
export interface BrowserCloseInput {
  sessionId: string;
}

/**
 * Result from taking a screenshot.
 */
export interface ScreenshotResult {
  path: string;
  width: number;
  height: number;
}
