/**
 * Create a tenant database record.
 *
 * Usage:
 *   npx tsx scripts/create-tenant.ts <name> <phone>
 *
 * Arguments:
 *   name  - Display name (e.g., "Anden")
 *   phone - Phone number in E.164 format (e.g., "+18015551234")
 *
 * Requires DATABASE_URL environment variable (via .env or exported).
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/create-tenant.ts <name> <phone>');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx scripts/create-tenant.ts "Anden" "+18015551234"');
  process.exit(1);
}

const [tenantName, tenantPhone] = args;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check if tenant already exists with this phone
  const existing = await prisma.tenant.findFirst({
    where: { phone_number: tenantPhone }
  });

  if (existing) {
    console.log('Tenant already exists:', existing.id);
    return existing;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      phone_number: tenantPhone,
      whatsapp_phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '123456789',
      status: 'ACTIVE',
      onboarding_status: 'LIVE'
    }
  });

  console.log('Created tenant:', tenant.id);
  return tenant;
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
