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
      take: 20,
      orderBy: { created_at: 'desc' },
      include: { tenant: { select: { name: true } } }
    });

    console.log('\n=== Recent Messages (20 most recent) ===\n');
    msgs.forEach((m, i) => {
      console.log(`[${i + 1}] ${m.direction} - ${m.tenant.name}`);
      console.log(`    From: ${m.sender_phone}`);
      console.log(`    Content: ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`);
      console.log(`    Status: ${m.delivery_status} | Created: ${m.created_at}`);
      console.log('');
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
