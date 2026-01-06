import { browserSessionManager } from '../../services/browserSessionManager.js';
import { Tool } from '../types.js';

/**
 * Format duration from milliseconds to human-readable string.
 * Examples: "5 minutes", "1 hour", "2 hours 30 minutes"
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
  } else if (hours > 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  } else {
    return 'less than a minute';
  }
}

/**
 * Tool for listing all active browser sessions for a tenant.
 */
export const browserListTool: Tool = {
  name: 'browser_list',
  description:
    'List all active browser sessions for this tenant. Shows session ID, current URL, and how long each has been open.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_input, context) => {
    try {
      const sessions = browserSessionManager.listSessions(context.tenantId);

      if (sessions.length === 0) {
        return 'No active browser sessions.';
      }

      // Build session list with page info
      const sessionEntries: string[] = [];
      const now = Date.now();

      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const durationMs = now - session.createdAt.getTime();
        const duration = formatDuration(durationMs);

        // Try to get page info (URL and title) from the active session
        let url = 'Unknown';
        let title = 'Unknown';

        try {
          const fullSession = await browserSessionManager.getSession(
            context.tenantId,
            session.id
          );
          if (fullSession) {
            url = fullSession.page.url() || 'about:blank';
            title = await fullSession.page.title();
          }
        } catch {
          // Session may have become unhealthy, use defaults
        }

        const entry =
          `${i + 1}. ${session.id}\n` +
          `   URL: ${url}\n` +
          `   Title: ${title || '(no title)'}\n` +
          `   Open for: ${duration}\n` +
          `   Persistent: ${session.persistent ? 'Yes' : 'No'}`;

        sessionEntries.push(entry);
      }

      return `Active browser sessions (${sessions.length}):\n\n${sessionEntries.join('\n\n')}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error listing browser sessions: ${errorMessage}`;
    }
  },
};
