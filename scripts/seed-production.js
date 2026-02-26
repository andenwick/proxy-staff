#!/usr/bin/env node
/**
 * Seed production database with a tenant record.
 *
 * Usage:
 *   railway run node scripts/seed-production.js <id> <name> <phone>
 *
 * Arguments:
 *   id    - Tenant ID slug (e.g., "anden")
 *   name  - Display name (e.g., "Anden Wickstrand")
 *   phone - Phone number in E.164 format (e.g., "+18015551234")
 *
 * Requires DATABASE_URL environment variable.
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error('Usage: node scripts/seed-production.js <id> <name> <phone>');
  console.error('');
  console.error('Example:');
  console.error('  railway run node scripts/seed-production.js anden "Anden Wickstrand" "+18015551234"');
  process.exit(1);
}

const [tenantId, tenantName, tenantPhone] = args;

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString || connectionString.includes(':@')) {
    console.error('ERROR: DATABASE_URL is not set or is invalid');
    process.exit(1);
  }

  console.log('Connecting to database...');

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Check if tenant already exists
    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId }
    });

    if (existing) {
      console.log(`Tenant "${tenantId}" already exists:`, existing);
    } else {
      // Create the tenant
      const tenant = await prisma.tenant.create({
        data: {
          id: tenantId,
          name: tenantName,
          phone_number: tenantPhone,
          messaging_channel: 'TELEGRAM',
          status: 'ACTIVE',
          onboarding_status: 'LIVE',
          updated_at: new Date()
        }
      });
      console.log('Created tenant:', tenant);
    }

    // List all tenants
    const tenants = await prisma.tenant.findMany();
    console.log('\nAll tenants:', tenants.map(t => ({ id: t.id, name: t.name, channel: t.messaging_channel })));

  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
