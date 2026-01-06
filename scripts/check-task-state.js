require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const tasks = await prisma.scheduledTask.findMany({
    orderBy: { created_at: 'desc' },
    take: 3
  });

  for (const t of tasks) {
    console.log('---');
    console.log('Prompt:', t.task_prompt);
    console.log('Type:', t.task_type);
    console.log('Next run:', t.next_run_at);
    console.log('Last run:', t.last_run_at);
    console.log('execution_plan:', JSON.stringify(t.execution_plan, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
