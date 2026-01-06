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
    const tenants = await prisma.tenants.findMany();
    console.log('Tenants:');
    tenants.forEach(t => {
      console.log(`\nID: ${t.id}`);
      console.log(`Name: ${t.name}`);
      console.log(`Phone: ${t.user_phone}`);
      console.log(`Channel: ${t.messaging_channel}`);
      console.log(`Telegram Chat ID: ${t.telegram_chat_id || 'not linked'}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
