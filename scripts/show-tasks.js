require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    const tasks = await prisma.scheduled_tasks.findMany({
      orderBy: { created_at: 'desc' },
      include: { tenants: { select: { name: true } } }
    });

    console.log('\n=== Scheduled Tasks ===\n');
    if (tasks.length === 0) {
      console.log('No scheduled tasks found.');
    } else {
      tasks.forEach((t, i) => {
        console.log(`[${i + 1}] ${t.task_prompt.substring(0, 80)}${t.task_prompt.length > 80 ? '...' : ''}`);
        console.log(`    Tenant: ${t.tenants.name} | Phone: ${t.user_phone}`);
        console.log(`    Type: ${t.task_type} | Enabled: ${t.enabled} | One-time: ${t.is_one_time}`);
        console.log(`    Cron: ${t.cron_expr || 'N/A'} | Run at: ${t.run_at || 'N/A'}`);
        console.log(`    Next run: ${t.next_run_at} | Last run: ${t.last_run_at || 'Never'}`);
        console.log(`    Created: ${t.created_at}`);
        console.log('');
      });
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
