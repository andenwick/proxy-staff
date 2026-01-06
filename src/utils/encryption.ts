import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { getConfig } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SCRYPT_SALT = 'proxystaff-credential-encryption-v1'; // Fixed salt for key derivation

// Cache derived key to avoid repeated scrypt calls
let derivedKeyCache: Buffer | null = null;
let lastKeySource: string | null = null;

/**
 * Get the encryption key from config.
 * Uses scrypt to derive a proper 256-bit key from the configured secret.
 * @throws Error if key is too short (minimum 16 characters for security)
 */
function getEncryptionKey(): Buffer {
  const key = getConfig().credentialsEncryptionKey;

  // Security: Require minimum key length
  if (!key || key.length < 16) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters. ' +
      'Use a strong, random secret for production.'
    );
  }

  // Return cached key if source hasn't changed
  if (derivedKeyCache && lastKeySource === key) {
    return derivedKeyCache;
  }

  // Derive a proper 256-bit key using scrypt
  // scrypt is memory-hard, making brute force attacks expensive
  derivedKeyCache = scryptSync(key, SCRYPT_SALT, 32, {
    N: 16384,  // CPU/memory cost parameter
    r: 8,      // Block size
    p: 1,      // Parallelization
  });
  lastKeySource = key;

  return derivedKeyCache;
}

/**
 * Encrypt a credential value using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext + auth tag.
 */
export function encryptCredential(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine IV + ciphertext + auth tag
  const combined = Buffer.concat([iv, encrypted, authTag]);

  return combined.toString('base64');
}

/**
 * Decrypt a credential value encrypted with encryptCredential.
 * Expects a base64-encoded string containing IV + ciphertext + auth tag.
 */
export function decryptCredential(encryptedValue: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedValue, 'base64');

  // Extract IV, ciphertext, and auth tag
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
