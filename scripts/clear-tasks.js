const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

require('dotenv').config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

async function main() {
  // Delete all scheduled tasks
  const result = await p.scheduledTask.deleteMany({});
  console.log('Deleted tasks:', result.count);
}

main()
  .catch(console.error)
  .finally(() => {
    p.$disconnect();
    pool.end();
  });
