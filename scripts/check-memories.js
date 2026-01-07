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
    const count = await prisma.tenant_memories.count();
    console.log('Total memories in database:', count);

    const memories = await prisma.tenant_memories.findMany({ take: 10 });
    console.log('\nRecent memories:');
    memories.forEach(m => {
      console.log(`\n[${m.tenant_id}] ${m.memory_type} (v${m.version})`);
      console.log(`Data: ${JSON.stringify(m.data, null, 2).substring(0, 200)}...`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
