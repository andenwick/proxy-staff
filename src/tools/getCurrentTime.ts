import { Tool } from './types.js';

/**
 * Simple tool that returns the current date and time.
 * Useful for testing the tool framework.
 */
export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Get the current date and time. Use this when the user asks what time it is or needs to know the current date.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Optional timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC.',
      },
    },
    required: [],
  },
  execute: async (input) => {
    const timezone = (input.timezone as string) || 'UTC';

    try {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });

      return `Current time: ${formatted}`;
    } catch {
      return `Error: Invalid timezone "${timezone}". Use a valid IANA timezone like "America/New_York".`;
    }
  },
};
