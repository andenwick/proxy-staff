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
    const tasks = await prisma.scheduled_tasks.findMany({
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    console.log('Recent scheduled tasks:');
    tasks.forEach(t => {
      console.log(`\n[Created: ${t.created_at.toLocaleString()}]`);
      console.log(`Task: ${t.task_prompt}`);
      console.log(`Type: ${t.task_type}`);
      console.log(`next_run_at: ${t.next_run_at?.toLocaleString()}`);
      console.log(`last_run_at: ${t.last_run_at?.toLocaleString() || 'never'}`);
      console.log(`is_one_time: ${t.is_one_time}, enabled: ${t.enabled}`);
      console.log(`execution_plan: ${JSON.stringify(t.execution_plan)}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
