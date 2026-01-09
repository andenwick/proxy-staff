require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

// Always use production DB for this debug script
const url = 'postgresql://postgres:JYVBdXPOxEPwlfwMfFeeJpBRimFktoET@gondola.proxy.rlwy.net:52176/railway';

async function main() {
  const pool = new pg.Pool({
    connectionString: url,
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
