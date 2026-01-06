/**
 * Add encrypted credentials to the database.
 *
 * Usage:
 *   npx tsx scripts/add-credential.js <tenant_id> <service_name> <value>
 *
 * Example:
 *   npx tsx scripts/add-credential.js 467db405-db1f-4d96-b2a0-d201cc78fa35 imyfone_email user@example.com
 *   npx tsx scripts/add-credential.js 467db405-db1f-4d96-b2a0-d201cc78fa35 imyfone_password mysecretpass
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createCipheriv, randomBytes, scryptSync, randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SCRYPT_SALT = 'proxystaff-credential-encryption-v1';

function getEncryptionKey() {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters');
  }
  return scryptSync(key, SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
}

function encryptCredential(value) {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined.toString('base64');
}

function getPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function main() {
  const [tenantId, serviceName, value] = process.argv.slice(2);

  if (!tenantId || !serviceName || !value) {
    console.log('Usage: npx tsx scripts/add-credential.js <tenant_id> <service_name> <value>');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/add-credential.js abc123 imyfone_email user@example.com');
    console.log('  npx tsx scripts/add-credential.js abc123 imyfone_password mysecretpass');
    process.exit(1);
  }

  const prisma = getPrismaClient();

  try {
    // Check tenant exists
    const tenant = await prisma.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      console.error(`Error: Tenant ${tenantId} not found`);
      process.exit(1);
    }

    const encryptedValue = encryptCredential(value);

    // Upsert credential
    await prisma.tenant_credentials.upsert({
      where: {
        tenant_id_service_name: { tenant_id: tenantId, service_name: serviceName }
      },
      update: {
        encrypted_value: encryptedValue,
        updated_at: new Date()
      },
      create: {
        id: randomUUID(),
        tenant_id: tenantId,
        service_name: serviceName,
        encrypted_value: encryptedValue,
        updated_at: new Date()
      }
    });

    console.log(`✓ Credential "${serviceName}" saved for tenant ${tenantId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
