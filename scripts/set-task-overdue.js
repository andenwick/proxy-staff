require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Set the email task to run 30 minutes ago
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const result = await prisma.scheduled_tasks.updateMany({
      where: { task_prompt: { contains: 'email' } },
      data: { next_run_at: thirtyMinutesAgo }
    });

    console.log(`Updated ${result.count} task(s) to be 30 minutes overdue`);
    console.log(`next_run_at set to: ${thirtyMinutesAgo}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
