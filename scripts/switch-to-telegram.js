require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const updated = await prisma.tenants.update({
      where: { id: '467db405-db1f-4d96-b2a0-d201cc78fa35' },
      data: { messaging_channel: 'TELEGRAM' },
    });
    console.log('Tenant updated to TELEGRAM:');
    console.log(`ID: ${updated.id}`);
    console.log(`Name: ${updated.name}`);
    console.log(`Channel: ${updated.messaging_channel}`);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
