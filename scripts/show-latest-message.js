require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const msgs = await prisma.messages.findMany({
      take: 5,
      orderBy: { created_at: 'desc' }
    });

    msgs.forEach((msg, i) => {
      console.log(`\n=== Message ${i + 1} (${msg.direction}) ===`);
      console.log(`Created: ${msg.created_at}`);
      console.log(`Content:\n${msg.content}`);
      console.log('\n---');
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
