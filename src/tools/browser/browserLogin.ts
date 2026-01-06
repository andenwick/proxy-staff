import { Tool } from '../types.js';
import { logger } from '../../utils/logger.js';
import { incrementCounter, recordTiming } from '../../utils/metrics.js';
import { browserSessionManager } from '../../services/browserSessionManager.js';

/**
 * Browser login tool - fills login forms using stored credentials.
 * Credentials are fetched from the encrypted tenant_credentials table.
 */
export const browserLoginTool: Tool = {
  name: 'browser_login',
  description:
    'Fill a login form using stored credentials. Provide the service name (e.g., "imyfone") and CSS selectors for the email/username and password fields. Credentials must be pre-stored as {service}_email and {service}_password.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The session ID from browser_open',
      },
      service: {
        type: 'string',
        description:
          'Service name for credential lookup (e.g., "imyfone" will look for "imyfone_email" and "imyfone_password")',
      },
      emailSelector: {
        type: 'string',
        description: 'CSS selector for email/username input (default: input[type="email"], input[name="email"])',
      },
      passwordSelector: {
        type: 'string',
        description: 'CSS selector for password input (default: input[type="password"])',
      },
      submitSelector: {
        type: 'string',
        description: 'CSS selector for submit button (optional - will click if provided)',
      },
    },
    required: ['sessionId', 'service'],
  },
  execute: async (input, context) => {
    const startMs = Date.now();
    const sessionId = input.sessionId as string;
    const service = input.service as string;
    const emailSelector =
      (input.emailSelector as string) || 'input[type="email"], input[name="email"], input[name="username"]';
    const passwordSelector = (input.passwordSelector as string) || 'input[type="password"]';
    const submitSelector = input.submitSelector as string | undefined;

    try {
      // Get session
      const session = await browserSessionManager.getSession(context.tenantId, sessionId);
      if (!session) {
        incrementCounter('browser_logins', { status: 'session_not_found' });
        return `Error: Session ${sessionId} not found. Use browser_open first.`;
      }

      // Fetch credentials
      const email = await context.getCredential(`${service}_email`);
      const password = await context.getCredential(`${service}_password`);

      if (!email || !password) {
        incrementCounter('browser_logins', { status: 'missing_credentials' });
        const missing = [];
        if (!email) missing.push(`${service}_email`);
        if (!password) missing.push(`${service}_password`);
        return `Error: Missing credentials: ${missing.join(', ')}. Add them using the add-credential script.`;
      }

      // Fill email field
      try {
        await session.page.fill(emailSelector, email, { timeout: 10000 });
      } catch {
        return `Error: Could not find email input. Try specifying emailSelector manually.`;
      }

      // Fill password field
      try {
        await session.page.fill(passwordSelector, password, { timeout: 10000 });
      } catch {
        return `Error: Could not find password input. Try specifying passwordSelector manually.`;
      }

      // Click submit if selector provided
      if (submitSelector) {
        try {
          await session.page.click(submitSelector, { timeout: 10000 });
          // Wait for navigation
          await session.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
            // Ignore timeout - some sites use AJAX
          });
        } catch {
          return `Filled login form but could not click submit button. Try clicking manually with browser_click.`;
        }
      }

      recordTiming('browser_login_ms', Date.now() - startMs, { status: 'ok' });
      incrementCounter('browser_logins', { status: 'ok' });

      const result = submitSelector
        ? `Filled and submitted login form for ${service}. Check if login succeeded.`
        : `Filled login form for ${service}. Use browser_click to submit.`;

      // Log success (without credentials!)
      logger.info(
        { tenantId: context.tenantId, sessionId, service, submitted: !!submitSelector },
        'Browser login completed'
      );

      return result;
    } catch (error) {
      const err = error as Error;
      recordTiming('browser_login_ms', Date.now() - startMs, { status: 'error' });
      incrementCounter('browser_logins', { status: 'error' });

      logger.error(
        { tenantId: context.tenantId, sessionId, service, error: err.message },
        'Browser login failed'
      );

      return `Error: ${err.message}`;
    }
  },
};
