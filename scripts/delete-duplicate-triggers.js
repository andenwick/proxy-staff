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
    where: {
      tenant_id: 'tenant_mom',
      trigger_type: 'EVENT'
    },
    select: { id: true, name: true, created_at: true }
  });

  console.log('Found triggers:');
  triggers.forEach(t => console.log(t.id, t.name, t.created_at));

  // Keep the newest one, delete the others
  if (triggers.length > 1) {
    const sorted = triggers.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const toDelete = sorted.slice(1);
    console.log('\nDeleting duplicates:');
    for (const t of toDelete) {
      await prisma.triggers.delete({ where: { id: t.id } });
      console.log('Deleted:', t.id);
    }
  } else {
    console.log('No duplicates to delete');
  }

  await pool.end();
}

main();
