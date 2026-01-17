/**
 * Credential Validators
 *
 * Non-destructive validation of API credentials for services with skip_test tools.
 * These validators only check if credentials are valid, they don't perform any
 * destructive actions (no sending emails, no transfers, etc.).
 */

import * as crypto from 'crypto';
import { logger as baseLogger } from '../utils/logger.js';

const logger = baseLogger.child({ module: 'credential-validators' });

// =============================================================================
// Types
// =============================================================================

export interface CredentialValidationResult {
  valid: boolean;
  error?: string;
}

export interface CredentialValidator {
  service: string;
  envVars: string[];
  toolsAffected: string[];
  validate: (env: Record<string, string>) => Promise<CredentialValidationResult>;
}

export interface CredentialCheckResult {
  service: string;
  tenantId: string;
  valid: boolean;
  error?: string;
  missingVars?: string[];
}

// =============================================================================
// Validator Implementations
// =============================================================================

/**
 * Google OAuth validator.
 * Validates credentials by attempting a token refresh (non-destructive).
 */
async function validateGoogleOAuth(env: Record<string, string>): Promise<CredentialValidationResult> {
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return { valid: false, error: 'Missing required environment variables' };
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `Token refresh failed: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        errorMessage = `Token refresh failed: ${errorJson.error || errorJson.error_description || response.status}`;
      } catch {
        // Use status code if body isn't JSON
      }
      return { valid: false, error: errorMessage };
    }

    const data = await response.json() as { access_token?: string };
    if (!data.access_token) {
      return { valid: false, error: 'Token refresh succeeded but no access_token returned' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Token refresh request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * SendGrid validator.
 * Validates credentials by calling GET /v3/user/profile (non-destructive).
 */
async function validateSendGrid(env: Record<string, string>): Promise<CredentialValidationResult> {
  const apiKey = env.SENDGRID_API_KEY;

  if (!apiKey) {
    return { valid: false, error: 'Missing SENDGRID_API_KEY' };
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `API request failed: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.errors && errorJson.errors[0]) {
          errorMessage = `API request failed: ${errorJson.errors[0].message || response.status}`;
        }
      } catch {
        // Use status code if body isn't JSON
      }
      return { valid: false, error: errorMessage };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `API request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Coinbase validator.
 * Validates credentials by calling GET /v2/user with HMAC authentication (non-destructive).
 */
async function validateCoinbase(env: Record<string, string>): Promise<CredentialValidationResult> {
  const apiKey = env.COINBASE_API_KEY;
  const apiSecret = env.COINBASE_API_SECRET;

  if (!apiKey || !apiSecret) {
    return { valid: false, error: 'Missing COINBASE_API_KEY or COINBASE_API_SECRET' };
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const method = 'GET';
    const requestPath = '/v2/user';
    const body = '';

    // Create HMAC signature (Coinbase API v2 authentication)
    const message = timestamp + method + requestPath + body;
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(message)
      .digest('hex');

    const response = await fetch(`https://api.coinbase.com${requestPath}`, {
      method: 'GET',
      headers: {
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-VERSION': '2024-01-01',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `API request failed: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.errors && errorJson.errors[0]) {
          errorMessage = `API request failed: ${errorJson.errors[0].message || response.status}`;
        }
      } catch {
        // Use status code if body isn't JSON
      }
      return { valid: false, error: errorMessage };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `API request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// =============================================================================
// Validator Registry
// =============================================================================

export const credentialValidators: CredentialValidator[] = [
  {
    service: 'google_oauth',
    envVars: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN'],
    toolsAffected: [
      'gmail_send',
      'gmail_send_html',
      'drive_upload',
      'drive_delete',
      'drive_create_doc',
      'drive_move_rename',
      'drive_move_to_folder_by_name',
      'drive_share_link',
      'drive_export_pdf',
      'docs_format',
      'calendar_create_event',
    ],
    validate: validateGoogleOAuth,
  },
  {
    service: 'sendgrid',
    envVars: ['SENDGRID_API_KEY'],
    toolsAffected: ['send_email'],
    validate: validateSendGrid,
  },
  {
    service: 'coinbase',
    envVars: ['COINBASE_API_KEY', 'COINBASE_API_SECRET'],
    toolsAffected: ['coinbase_send_crypto'],
    validate: validateCoinbase,
  },
];

/**
 * Check if a service has all required env vars configured.
 * Returns missing var names if any are missing.
 */
export function checkEnvVarsPresent(
  validator: CredentialValidator,
  env: Record<string, string>
): string[] {
  const missing: string[] = [];
  for (const varName of validator.envVars) {
    if (!env[varName]) {
      missing.push(varName);
    }
  }
  return missing;
}

/**
 * Get validator by service name.
 */
export function getValidatorByService(serviceName: string): CredentialValidator | undefined {
  return credentialValidators.find(v => v.service === serviceName);
}
