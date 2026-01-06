require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Get all async jobs
  const jobs = await prisma.async_jobs.findMany({
    orderBy: { created_at: 'desc' },
    take: 10
  });
  console.log('=== Recent Async Jobs ===');
  for (const job of jobs) {
    console.log(`[${job.created_at.toLocaleString()}] ${job.status}`);
    console.log(`Input: ${job.input_message}`);
    console.log(`Output: ${job.output_result ? job.output_result.substring(0, 500) : 'N/A'}`);
    console.log(`Error: ${job.error_message || 'N/A'}`);
    console.log('---');
  }

  await prisma.$disconnect();
  await pool.end();
}
main().catch(console.error);
