import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Get all tenants
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true, phone_number: true, whatsapp_phone_number_id: true },
    });
    console.log('Tenants:', JSON.stringify(tenants, null, 2));

    // Get existing configs
    const configs = await prisma.tenantConfig.findMany();
    console.log('\nExisting TenantConfigs:', JSON.stringify(configs, null, 2));

    // For each tenant without a config, create one with tools enabled
    for (const tenant of tenants) {
      const existingConfig = configs.find((c) => c.tenant_id === tenant.id);
      if (!existingConfig) {
        console.log(`\nCreating TenantConfig for tenant: ${tenant.name} (${tenant.id})`);
        const newConfig = await prisma.tenantConfig.create({
          data: {
            tenant_id: tenant.id,
            system_prompt: 'You are a helpful AI assistant for a real estate professional. Be concise, friendly, and helpful.',
            enabled_tools: ['get_current_time', 'search_web'],
            max_history_messages: 20,
          },
        });
        console.log('Created config:', JSON.stringify(newConfig, null, 2));
      } else {
        console.log(`\nTenant ${tenant.name} already has config. enabled_tools:`, existingConfig.enabled_tools);

        // If enabled_tools is empty, update it
        if (existingConfig.enabled_tools.length === 0) {
          console.log('enabled_tools is empty, updating...');
          const updated = await prisma.tenantConfig.update({
            where: { id: existingConfig.id },
            data: { enabled_tools: ['get_current_time', 'search_web'] },
          });
          console.log('Updated config:', JSON.stringify(updated, null, 2));
        }
      }
    }

    console.log('\nDone!');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
