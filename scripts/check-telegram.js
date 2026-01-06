require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const tenants = await prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        telegram_chat_id: true,
        messaging_channel: true,
        status: true
      }
    });
    console.log('Tenants with Telegram info:');
    console.log(JSON.stringify(tenants, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
main();
