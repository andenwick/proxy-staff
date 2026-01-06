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
    const messages = await prisma.messages.findMany({
      orderBy: { created_at: 'desc' },
      take: 15,
    });

    console.log('Recent messages:');
    messages.forEach(m => {
      console.log(`\n[${m.created_at.toLocaleString()}] ${m.direction}`);
      console.log(`Phone: ${m.sender_phone}`);
      console.log(`Content: ${m.content}`);  // Show full content
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
