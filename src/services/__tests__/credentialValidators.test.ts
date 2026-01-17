/**
 * Credential Validators Tests
 *
 * Unit tests for individual credential validators.
 */

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

import {
  credentialValidators,
  checkEnvVarsPresent,
  getValidatorByService,
} from '../credentialValidators.js';

describe('Credential Validators', () => {
  // =============================================================================
  // Helper Function Tests
  // =============================================================================

  describe('checkEnvVarsPresent', () => {
    const mockValidator = {
      service: 'test_service',
      envVars: ['VAR_A', 'VAR_B', 'VAR_C'],
      toolsAffected: ['tool1'],
      validate: jest.fn(),
    };

    it('returns empty array when all env vars present', () => {
      const env = { VAR_A: 'a', VAR_B: 'b', VAR_C: 'c' };
      const missing = checkEnvVarsPresent(mockValidator, env);
      expect(missing).toEqual([]);
    });

    it('returns missing var names when some vars missing', () => {
      const env = { VAR_A: 'a' };
      const missing = checkEnvVarsPresent(mockValidator, env);
      expect(missing).toContain('VAR_B');
      expect(missing).toContain('VAR_C');
      expect(missing).not.toContain('VAR_A');
    });

    it('returns all var names when all vars missing', () => {
      const env = {};
      const missing = checkEnvVarsPresent(mockValidator, env);
      expect(missing).toEqual(['VAR_A', 'VAR_B', 'VAR_C']);
    });
  });

  describe('getValidatorByService', () => {
    it('returns validator for google_oauth', () => {
      const validator = getValidatorByService('google_oauth');
      expect(validator).toBeDefined();
      expect(validator?.service).toBe('google_oauth');
      expect(validator?.envVars).toContain('GOOGLE_DRIVE_CLIENT_ID');
    });

    it('returns validator for sendgrid', () => {
      const validator = getValidatorByService('sendgrid');
      expect(validator).toBeDefined();
      expect(validator?.service).toBe('sendgrid');
      expect(validator?.envVars).toContain('SENDGRID_API_KEY');
    });

    it('returns validator for coinbase', () => {
      const validator = getValidatorByService('coinbase');
      expect(validator).toBeDefined();
      expect(validator?.service).toBe('coinbase');
      expect(validator?.envVars).toContain('COINBASE_API_KEY');
    });

    it('returns undefined for unknown service', () => {
      const validator = getValidatorByService('unknown_service');
      expect(validator).toBeUndefined();
    });
  });

  // =============================================================================
  // Validator Registry Tests
  // =============================================================================

  describe('credentialValidators registry', () => {
    it('contains google_oauth validator', () => {
      const validator = credentialValidators.find(v => v.service === 'google_oauth');
      expect(validator).toBeDefined();
      expect(validator?.envVars).toEqual([
        'GOOGLE_DRIVE_CLIENT_ID',
        'GOOGLE_DRIVE_CLIENT_SECRET',
        'GOOGLE_DRIVE_REFRESH_TOKEN',
      ]);
      expect(validator?.toolsAffected).toContain('gmail_send');
      expect(validator?.toolsAffected).toContain('drive_upload');
    });

    it('contains sendgrid validator', () => {
      const validator = credentialValidators.find(v => v.service === 'sendgrid');
      expect(validator).toBeDefined();
      expect(validator?.envVars).toEqual(['SENDGRID_API_KEY']);
      expect(validator?.toolsAffected).toContain('send_email');
    });

    it('contains coinbase validator', () => {
      const validator = credentialValidators.find(v => v.service === 'coinbase');
      expect(validator).toBeDefined();
      expect(validator?.envVars).toEqual(['COINBASE_API_KEY', 'COINBASE_API_SECRET']);
      expect(validator?.toolsAffected).toContain('coinbase_send_crypto');
    });
  });

  // =============================================================================
  // Google OAuth Validator Tests
  // =============================================================================

  describe('Google OAuth validator', () => {
    const googleValidator = credentialValidators.find(v => v.service === 'google_oauth')!;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns invalid when env vars missing', async () => {
      const result = await googleValidator.validate({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing required environment variables');
    });

    it('returns invalid when refresh token missing', async () => {
      const result = await googleValidator.validate({
        GOOGLE_DRIVE_CLIENT_ID: 'test-id',
        GOOGLE_DRIVE_CLIENT_SECRET: 'test-secret',
      });
      expect(result.valid).toBe(false);
    });

    it('returns invalid on network error', async () => {
      // Mock fetch to throw network error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await googleValidator.validate({
        GOOGLE_DRIVE_CLIENT_ID: 'test-id',
        GOOGLE_DRIVE_CLIENT_SECRET: 'test-secret',
        GOOGLE_DRIVE_REFRESH_TOKEN: 'test-token',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('returns invalid on API error response', async () => {
      // Mock fetch to return error response
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"error": "invalid_grant"}'),
      });

      const result = await googleValidator.validate({
        GOOGLE_DRIVE_CLIENT_ID: 'test-id',
        GOOGLE_DRIVE_CLIENT_SECRET: 'test-secret',
        GOOGLE_DRIVE_REFRESH_TOKEN: 'invalid-token',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid_grant');
    });

    it('returns valid on successful token refresh', async () => {
      // Mock fetch to return success
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'new-access-token' }),
      });

      const result = await googleValidator.validate({
        GOOGLE_DRIVE_CLIENT_ID: 'test-id',
        GOOGLE_DRIVE_CLIENT_SECRET: 'test-secret',
        GOOGLE_DRIVE_REFRESH_TOKEN: 'valid-token',
      });

      expect(result.valid).toBe(true);
    });
  });

  // =============================================================================
  // SendGrid Validator Tests
  // =============================================================================

  describe('SendGrid validator', () => {
    const sendgridValidator = credentialValidators.find(v => v.service === 'sendgrid')!;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns invalid when API key missing', async () => {
      const result = await sendgridValidator.validate({});
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing SENDGRID_API_KEY');
    });

    it('returns invalid on API error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"errors": [{"message": "invalid api key"}]}'),
      });

      const result = await sendgridValidator.validate({
        SENDGRID_API_KEY: 'invalid-key',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid api key');
    });

    it('returns valid on successful API call', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ email: 'test@example.com' }),
      });

      const result = await sendgridValidator.validate({
        SENDGRID_API_KEY: 'valid-key',
      });

      expect(result.valid).toBe(true);
    });
  });

  // =============================================================================
  // Coinbase Validator Tests
  // =============================================================================

  describe('Coinbase validator', () => {
    const coinbaseValidator = credentialValidators.find(v => v.service === 'coinbase')!;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns invalid when API key missing', async () => {
      const result = await coinbaseValidator.validate({
        COINBASE_API_SECRET: 'secret',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing COINBASE_API_KEY');
    });

    it('returns invalid when API secret missing', async () => {
      const result = await coinbaseValidator.validate({
        COINBASE_API_KEY: 'key',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing COINBASE_API_KEY or COINBASE_API_SECRET');
    });

    it('returns invalid on API error response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"errors": [{"message": "invalid signature"}]}'),
      });

      const result = await coinbaseValidator.validate({
        COINBASE_API_KEY: 'invalid-key',
        COINBASE_API_SECRET: 'invalid-secret',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid signature');
    });

    it('returns valid on successful API call', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 'user-123' } }),
      });

      const result = await coinbaseValidator.validate({
        COINBASE_API_KEY: 'valid-key',
        COINBASE_API_SECRET: 'valid-secret',
      });

      expect(result.valid).toBe(true);
    });
  });
});
