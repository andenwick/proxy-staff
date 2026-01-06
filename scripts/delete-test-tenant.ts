import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Delete test tenant
  const deleted = await prisma.tenant.delete({
    where: { id: 'ce022787-a5ad-4b0e-b5ec-a7952b317636' }
  });
  console.log('Deleted tenant:', deleted.name);
}

main()
  .catch(e => console.error('Error:', e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
