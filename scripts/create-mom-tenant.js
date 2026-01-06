const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.tenant.findFirst({
    where: { phone_number: '+18015546207' }
  });

  if (existing) {
    console.log('Tenant already exists:', existing);
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      id: 'tenant_mom',
      name: 'Mom',
      phone_number: '+18015546207',
      messaging_channel: 'TELEGRAM',
      status: 'ACTIVE',
      onboarding_status: 'DISCOVERY',
      updated_at: new Date()
    }
  });

  console.log('Created tenant:', tenant);
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
