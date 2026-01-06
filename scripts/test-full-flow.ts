import 'dotenv/config';
import { getPrismaClient, disconnectPrisma } from '../src/services/prisma';
import { ClaudeService } from '../src/services/claude';
import { TenantConfigService } from '../src/services/tenantConfig';
import { TenantDirectivesService } from '../src/services/tenantDirectives';
import { TenantToolsService } from '../src/services/tenantTools';
import { PythonRunnerService } from '../src/services/pythonRunner';
import { registerAllTools, toolRegistry } from '../src/tools/index';
import { setTenantDirectivesService, readDirectiveTool } from '../src/tools/readDirective';
import { decryptCredential } from '../src/utils/encryption';

const TENANT_ID = '467db405-db1f-4d96-b2a0-d201cc78fa35';
const SENDER_PHONE = '+18012321677';

async function main() {
  const prisma = getPrismaClient();

  // Register all shared tools
  registerAllTools();

  // Initialize services
  const claudeService = new ClaudeService();
  const tenantConfigService = new TenantConfigService(prisma);
  const tenantDirectivesService = new TenantDirectivesService();
  const pythonRunner = new PythonRunnerService();
  const tenantToolsService = new TenantToolsService(pythonRunner);

  setTenantDirectivesService(tenantDirectivesService);

  // Build Claude tool definitions from registry (like services/index.ts does)
  const claudeTools = new Map<string, { name: string; description: string; input_schema: Record<string, unknown> }>();
  for (const name of toolRegistry.getToolNames()) {
    const tool = toolRegistry.get(name);
    if (tool) {
      claudeTools.set(name, {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      });
    }
  }

  // Load tenant configuration (simulate what messageProcessor does)
  const dbConfig = await tenantConfigService.getTenantConfig(TENANT_ID);
  const folderSystemPrompt = await tenantDirectivesService.loadSystemPrompt(TENANT_ID);
  const tenantTools = await tenantToolsService.loadTenantTools(TENANT_ID);
  const directivesList = await tenantDirectivesService.listDirectives(TENANT_ID);

  // Build system prompt
  let systemPrompt = folderSystemPrompt!;
  if (directivesList.length > 0) {
    const directivesInfo = directivesList
      .filter(name => name !== 'README')
      .join(', ');
    if (directivesInfo) {
      systemPrompt += `\n\n## Available Directives\nYou can use the read_directive tool to load these SOPs: ${directivesInfo}`;
    }
  }

  // Build tools array
  const tools: { name: string; description: string; input_schema: Record<string, unknown> }[] = tenantTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  tools.push({
    name: readDirectiveTool.name,
    description: readDirectiveTool.description,
    input_schema: readDirectiveTool.inputSchema,
  });

  // Add shared tools
  const tenantToolNames = new Set(tenantTools.map(t => t.name));
  for (const [name, sharedTool] of claudeTools) {
    if (!tenantToolNames.has(name)) {
      tools.push(sharedTool);
    }
  }

  console.log('=== Tools being sent to Claude ===');
  for (const tool of tools) {
    console.log(`- ${tool.name}`);
  }

  // Create tool executor
  const toolExecutor = async (name: string, input: Record<string, unknown>): Promise<string> => {
    console.log(`\n>>> TOOL CALLED: ${name}`);
    console.log(`>>> INPUT: ${JSON.stringify(input, null, 2)}`);

    const context = {
      tenantId: TENANT_ID,
      senderPhone: SENDER_PHONE,
      prisma,
      getCredential: async (serviceName: string): Promise<string | null> => {
        const cred = await prisma.tenantCredential.findUnique({
          where: { tenant_id_service_name: { tenant_id: TENANT_ID, service_name: serviceName } },
        });
        if (!cred) return null;
        return decryptCredential(cred.encrypted_value);
      },
    };

    return await toolRegistry.execute(name, input, context);
  };

  // Test message
  const testMessage = 'schedule a reminder to say "test" in 2 minutes';
  console.log(`\n=== Sending test message: "${testMessage}" ===\n`);

  const messages = [{ role: 'user' as const, content: testMessage }];

  try {
    const response = await claudeService.sendMessage(
      systemPrompt,
      messages,
      tools,
      toolExecutor
    );
    console.log('\n=== Claude Response ===');
    console.log(response);
  } catch (error) {
    console.error('Error:', error);
  }

  // Check database for new tasks
  console.log('\n=== Checking database for scheduled tasks ===');
  const tasks = await prisma.scheduledTask.findMany({
    where: { tenant_id: TENANT_ID },
    orderBy: { created_at: 'desc' },
    take: 5,
  });
  console.log(`Found ${tasks.length} tasks`);
  for (const task of tasks) {
    console.log(`- ${task.id}: "${task.task_prompt}" scheduled for ${task.next_run_at}`);
  }
}

main()
  .catch(console.error)
  .finally(() => disconnectPrisma());
