#!/usr/bin/env node
/**
 * Seed production database with essential data
 * Run with: railway run node scripts/seed-production.js
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString || connectionString.includes(':@')) {
    console.error('ERROR: DATABASE_URL is not set or is invalid');
    console.error('Current value:', connectionString);
    process.exit(1);
  }

  console.log('Connecting to database...');

  const pool = new pg.Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Check if anden tenant already exists
    const existing = await prisma.tenant.findUnique({
      where: { id: 'anden' }
    });

    if (existing) {
      console.log('Tenant "anden" already exists:', existing);
    } else {
      // Create the anden tenant
      const tenant = await prisma.tenant.create({
        data: {
          id: 'anden',
          name: 'Anden Wiklund',
          phone_number: '+17204002865',  // Placeholder - will be updated on first message
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
