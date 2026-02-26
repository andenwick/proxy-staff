#!/usr/bin/env node
/**
 * Link a tenant to a Telegram chat by setting their telegram_chat_id.
 *
 * Usage:
 *   node scripts/link-telegram.js <tenant_id> <chat_id>
 *
 * Arguments:
 *   tenant_id - Tenant ID slug (e.g., "anden")
 *   chat_id   - Telegram chat ID to link
 *
 * Requires DATABASE_URL environment variable.
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/link-telegram.js <tenant_id> <chat_id>');
  console.error('');
  console.error('Example:');
  console.error('  DATABASE_URL="..." node scripts/link-telegram.js anden 123456789');
  process.exit(1);
}

const [tenantId, chatId] = args;

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

async function main() {
  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { telegram_chat_id: chatId }
    });

    console.log('Updated tenant:', updated);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
main();
