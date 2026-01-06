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

  // Update the trigger to AUTO mode
  const result = await prisma.triggers.updateMany({
    where: {
      tenant_id: 'tenant_mom',
      name: 'Email Summary - Outlook'
    },
    data: {
      autonomy: 'AUTO'
    }
  });

  console.log('Updated triggers:', result.count);

  // Verify
  const triggers = await prisma.triggers.findMany({
    where: { tenant_id: 'tenant_mom' },
    select: { name: true, autonomy: true }
  });
  console.log('Current triggers:', triggers);

  await pool.end();
}

main();
