import 'dotenv/config';
import { getPrismaClient, disconnectPrisma } from '../src/services/prisma';
import { scheduleTaskTool } from '../src/tools/scheduleTask';

const TENANT_ID = '467db405-db1f-4d96-b2a0-d201cc78fa35';
const USER_PHONE = '+18012321677';

async function main() {
  const prisma = getPrismaClient();

  console.log('=== Testing Schedule Task Tool ===\n');

  // Create context like the tool would receive
  const context = {
    tenantId: TENANT_ID,
    senderPhone: USER_PHONE,
    prisma,
    getCredential: async () => null,
  };

  // Test scheduling a task "in 1 min"
  const input = {
    task: 'Send message: yurrr',
    schedule: 'in 1 minute',
  };

  console.log('Input:', JSON.stringify(input, null, 2));
  console.log('\nExecuting schedule_task tool...\n');

  try {
    const result = await scheduleTaskTool.execute(input, context);
    console.log('Result:', result);
  } catch (error) {
    console.error('Error:', error);
  }

  // Check if task was created
  console.log('\n=== Checking Database ===\n');
  const tasks = await prisma.scheduledTask.findMany({
    where: { tenant_id: TENANT_ID },
    orderBy: { created_at: 'desc' },
    take: 5,
  });

  console.log(`Found ${tasks.length} tasks:`);
  for (const task of tasks) {
    console.log(`- ${task.id}: "${task.task_prompt}" at ${task.next_run_at}`);
  }
}

main()
  .catch(console.error)
  .finally(() => disconnectPrisma());
