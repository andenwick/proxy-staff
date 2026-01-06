require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.update({
    where: { id: 'tenant_mom' },
    data: { status: 'CHURNED' }
  });
  console.log('Disabled:', tenant.id);
  await prisma.$disconnect();
  await pool.end();
}

main();
