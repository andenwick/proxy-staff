import 'dotenv/config';
import { getPrismaClient, disconnectPrisma } from '../src/services/prisma';

async function main() {
  const prisma = getPrismaClient();

  // Get tenants
  const tenants = await prisma.tenant.findMany({
    include: { config: true }
  });

  console.log('=== Tenants ===\n');
  for (const tenant of tenants) {
    console.log(`ID: ${tenant.id}`);
    console.log(`Name: ${tenant.name}`);
    console.log(`Phone: ${tenant.phone_number}`);
    console.log(`Enabled tools: ${tenant.config?.enabled_tools?.join(', ') || 'N/A'}`);
    console.log('---');
  }

  // Check scheduled tasks
  const tasks = await prisma.scheduledTask.findMany({
    orderBy: { created_at: 'desc' },
    take: 20
  });

  console.log('\n=== Scheduled Tasks ===\n');
  if (tasks.length === 0) {
    console.log('No scheduled tasks found!\n');
  }
  for (const task of tasks) {
    console.log(`ID: ${task.id}`);
    console.log(`Enabled: ${task.enabled}`);
    console.log(`One-time: ${task.is_one_time}`);
    console.log(`Task: ${task.task_prompt}`);
    console.log(`User: ${task.user_phone}`);
    console.log(`Next run: ${task.next_run_at.toISOString()}`);
    console.log(`Created: ${task.created_at.toISOString()}`);
    console.log(`Cron: ${task.cron_expr || 'N/A'}`);
    console.log(`Run at: ${task.run_at?.toISOString() || 'N/A'}`);
    console.log(`Error count: ${task.error_count}`);
    console.log('---');
  }
}

main()
  .catch(console.error)
  .finally(() => disconnectPrisma());
