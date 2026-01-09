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
    // Update anden tenant with telegram_chat_id
    const updated = await prisma.tenant.update({
      where: { id: 'anden' },
      data: { telegram_chat_id: '6107811887' }
    });

    console.log('Updated tenant:', updated);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
main();
