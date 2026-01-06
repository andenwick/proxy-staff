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

  const triggers = await prisma.triggers.findMany({
    orderBy: { created_at: 'desc' },
    take: 10
  });

  console.log('Recent triggers:');
  for (const t of triggers) {
    console.log(`\n=== ${t.name} (${t.trigger_type}) ===`);
    console.log('Status:', t.status);
    console.log('Autonomy:', t.autonomy);
    console.log('Task Prompt:', t.task_prompt);
    console.log('Config:', JSON.stringify(t.config, null, 2));
    console.log('Last triggered:', t.last_triggered_at);
    console.log('Next check:', t.next_check_at);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
