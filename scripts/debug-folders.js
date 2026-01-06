require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Get tenant config with system prompt
    const config = await prisma.tenant_configs.findFirst();
    console.log('=== TENANT CONFIG ===');
    console.log('System Prompt:');
    console.log(config?.system_prompt || 'NO PROMPT');
    console.log('\n--- ENABLED TOOLS ---');
    console.log(config?.enabled_tools || []);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
