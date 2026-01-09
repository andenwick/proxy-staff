#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const url = process.env.DATABASE_URL || 'postgresql://postgres:JYVBdXPOxEPwlfwMfFeeJpBRimFktoET@gondola.proxy.rlwy.net:52176/railway';

async function main() {
  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const sessions = await prisma.conversationSession.count();
    const messages = await prisma.messages.count();
    const jobs = await prisma.async_jobs.count();
    const tenants = await prisma.tenant.findMany();

    console.log('Database state:');
    console.log('  Tenants:', tenants.map(t => t.id).join(', ') || 'none');
    console.log('  Sessions:', sessions);
    console.log('  Messages:', messages);
    console.log('  Async jobs:', jobs);

    if (tenants.length > 0) {
      console.log('');
      console.log('Tenant details:');
      tenants.forEach(t => {
        console.log('  - ' + t.id + ': telegram_chat_id=' + (t.telegram_chat_id || 'NOT LINKED'));
      });
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
main();
