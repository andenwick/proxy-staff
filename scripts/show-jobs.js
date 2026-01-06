require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Check all jobs, not just 10
  const jobs = await prisma.async_jobs.findMany({
    take: 20,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      status: true,
      error_message: true,
      input_message: true,
      created_at: true,
      completed_at: true,
      cancelled_at: true
    }
  });

  console.log('\n=== Recent Async Jobs (20) ===\n');
  jobs.forEach((j, i) => {
    console.log(`[${i+1}] Status: ${j.status}`);
    console.log(`    Message: ${(j.input_message || '').substring(0, 50)}`);
    console.log(`    Error: ${j.error_message || 'none'}`);
    console.log(`    Created: ${j.created_at}`);
    console.log('');
  });

  // Check if there are any pending/processing jobs
  const pendingJobs = await prisma.async_jobs.findMany({
    where: { status: { in: ['PENDING', 'PROCESSING'] } }
  });
  console.log(`\n=== Pending/Processing Jobs: ${pendingJobs.length} ===`);
  pendingJobs.forEach(j => {
    console.log(`  - ${j.status}: ${j.input_message?.substring(0, 30)} (${j.created_at})`);
  });

  await prisma.$disconnect();
  await pool.end();
}
main();
