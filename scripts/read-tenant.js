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

  const tenants = await prisma.tenant.findMany({
    include: {
      tenant_configs: {
        select: {
          system_prompt: true,
          enabled_tools: true
        }
      }
    }
  });

  for (const tenant of tenants) {
    console.log('=== Tenant:', tenant.name, '===');
    console.log('ID:', tenant.id);
    console.log('Phone:', tenant.phone_number);
    console.log('Status:', tenant.status);
    console.log('Enabled Tools:', tenant.tenant_configs?.enabled_tools?.join(', ') || 'None');
    console.log('System Prompt:');
    console.log(tenant.tenant_configs?.system_prompt || 'No system prompt');
    console.log('\n');
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
