/**
 * Delete a tenant by UUID.
 *
 * Usage:
 *   npx tsx scripts/delete-test-tenant.ts <tenant-uuid>
 *
 * Arguments:
 *   tenant-uuid - The UUID of the tenant to delete
 *
 * Requires DATABASE_URL environment variable (via .env or exported).
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error('Usage: npx tsx scripts/delete-test-tenant.ts <tenant-uuid>');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx scripts/delete-test-tenant.ts ce022787-a5ad-4b0e-b5ec-a7952b317636');
  process.exit(1);
}

const tenantUuid = args[0];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const deleted = await prisma.tenant.delete({
    where: { id: tenantUuid }
  });
  console.log('Deleted tenant:', deleted.name);
}

main()
  .catch(e => console.error('Error:', e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
