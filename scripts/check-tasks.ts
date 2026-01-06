import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const tasks = await prisma.scheduledTask.findMany();
  console.log('Scheduled Tasks:', JSON.stringify(tasks, null, 2));

  // Get recent messages
  const messages = await prisma.message.findMany({
    orderBy: { created_at: 'desc' },
    take: 20,
  });
  console.log('\nRecent Messages:', JSON.stringify(messages, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

main();
