import 'dotenv/config';
import { getPrismaClient, disconnectPrisma } from '../src/services/prisma';
import { registerAllTools, toolRegistry } from '../src/tools/index';
import { TenantDirectivesService } from '../src/services/tenantDirectives';
import { TenantToolsService } from '../src/services/tenantTools';
import { PythonRunnerService } from '../src/services/pythonRunner';
import { readDirectiveTool } from '../src/tools/readDirective';

const TENANT_ID = '467db405-db1f-4d96-b2a0-d201cc78fa35';

async function main() {
  // Register all shared tools (like the server does)
  registerAllTools();
  console.log('=== Registered Shared Tools ===');
  console.log(toolRegistry.getToolNames().join(', '));

  // Initialize tenant services
  const tenantDirectivesService = new TenantDirectivesService();
  const pythonRunner = new PythonRunnerService();
  const tenantToolsService = new TenantToolsService(pythonRunner);

  // Try to load system prompt from tenant folder (like messageProcessor does)
  const folderSystemPrompt = await tenantDirectivesService.loadSystemPrompt(TENANT_ID);
  console.log('\n=== Tenant Folder System Prompt ===');
  console.log(folderSystemPrompt ? `Loaded (${folderSystemPrompt.length} chars)` : 'NOT FOUND');

  // Load tenant tools
  const tenantTools = await tenantToolsService.loadTenantTools(TENANT_ID);
  console.log('\n=== Tenant Tools (from tool_manifest.json) ===');
  for (const tool of tenantTools) {
    console.log(`- ${tool.name}: ${tool.description.substring(0, 50)}...`);
  }

  // Now simulate what messageProcessor does - build the tools array
  console.log('\n=== Building Final Tools Array (like messageProcessor) ===');

  // Build tools array from tenant manifest
  const tools: { name: string; description: string; input_schema: any }[] = tenantTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));

  // Add read_directive built-in tool
  tools.push({
    name: readDirectiveTool.name,
    description: readDirectiveTool.description,
    input_schema: readDirectiveTool.inputSchema,
  });

  // Add all shared tools - THIS IS THE KEY PART
  // In messageProcessor, it uses this.toolRegistry which is a Map<string, ClaudeTool>
  // But toolRegistry here is the ToolRegistry class instance
  const tenantToolNames = new Set(tenantTools.map(t => t.name));

  // Get shared tools from registry
  const sharedToolNames = toolRegistry.getToolNames();
  console.log('\nShared tool names from registry:', sharedToolNames);

  for (const name of sharedToolNames) {
    if (!tenantToolNames.has(name)) {
      const tool = toolRegistry.get(name);
      if (tool) {
        tools.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        });
      }
    }
  }

  console.log('\n=== Final Tools Being Sent to Claude ===');
  for (const tool of tools) {
    console.log(`- ${tool.name}`);
  }

  console.log('\n=== Checking for schedule_task ===');
  const hasScheduleTask = tools.some(t => t.name === 'schedule_task');
  console.log(`schedule_task present: ${hasScheduleTask}`);
}

main()
  .catch(console.error)
  .finally(() => disconnectPrisma());
