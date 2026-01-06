import { logger } from './logger.js';

/**
 * Validation utilities for security-critical input sanitization.
 */

/**
 * Validate a tenant ID to prevent path traversal attacks.
 * Valid tenant IDs must be alphanumeric with optional hyphens/underscores.
 * @throws Error if tenant ID is invalid
 */
export function validateTenantId(tenantId: string): void {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('Tenant ID is required');
  }

  // Check for path traversal attempts
  if (tenantId.includes('..') || tenantId.includes('/') || tenantId.includes('\\')) {
    logger.warn({ tenantId: tenantId.substring(0, 50) }, 'Path traversal attempt detected in tenant ID');
    throw new Error('Invalid tenant ID: contains path traversal characters');
  }

  // Only allow alphanumeric, hyphens, and underscores
  // UUID format: 8-4-4-4-12 hex chars with hyphens
  const validPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
  if (!validPattern.test(tenantId)) {
    throw new Error('Invalid tenant ID: must be alphanumeric with optional hyphens or underscores');
  }

  // Reasonable length limit
  if (tenantId.length > 64) {
    throw new Error('Invalid tenant ID: exceeds maximum length of 64 characters');
  }
}

/**
 * Validate a phone number format.
 * Must be digits only, 10-15 chars (international format without +).
 */
export function validatePhoneNumber(phone: string): void {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number is required');
  }

  const digitsOnly = /^\d{10,15}$/;
  if (!digitsOnly.test(phone)) {
    throw new Error('Invalid phone number: must be 10-15 digits');
  }
}

/**
 * Sanitize a phone number for logging (hide most digits for privacy).
 */
export function sanitizePhoneForLog(phone: string): string {
  if (!phone || phone.length < 4) {
    return '****';
  }
  return `***${phone.slice(-4)}`;
}

/**
 * Validate that a string is not empty after trimming.
 */
export function validateNonEmpty(value: string, fieldName: string): void {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
}

/**
 * Validate session ID format (UUID v4).
 */
export function validateSessionId(sessionId: string): void {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Session ID is required');
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(sessionId)) {
    throw new Error('Invalid session ID format');
  }
}
