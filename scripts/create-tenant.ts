import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check if tenant already exists
  const existing = await prisma.tenant.findFirst({
    where: { phone_number: '+18012321677' }
  });

  if (existing) {
    console.log('Tenant already exists:', existing.id);
    return existing;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Anden',
      phone_number: '+18012321677',
      whatsapp_phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '123456789',
      status: 'ACTIVE',
      onboarding_status: 'LIVE'
    }
  });

  console.log('Created tenant:', tenant.id);
  return tenant;
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
