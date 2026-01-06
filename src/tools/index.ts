import { toolRegistry } from './registry.js';
import { getCurrentTimeTool } from './getCurrentTime.js';
import { searchWebTool } from './searchWeb.js';
import { searchHistoryTool } from './searchHistory.js';
import { scheduleTaskTool } from './scheduleTask.js';
import { listSchedulesTool } from './listSchedules.js';
import { cancelScheduleTool } from './cancelSchedule.js';
import { browserTools } from './browser/index.js';

// Register all tools
export function registerAllTools(): void {
  toolRegistry.register(getCurrentTimeTool);
  toolRegistry.register(searchWebTool);
  toolRegistry.register(searchHistoryTool);
  toolRegistry.register(scheduleTaskTool);
  toolRegistry.register(listSchedulesTool);
  toolRegistry.register(cancelScheduleTool);

  // Register browser automation tools
  for (const tool of browserTools) {
    toolRegistry.register(tool);
  }
}

// Export registry and types for external use
export { toolRegistry } from './registry.js';
export type { Tool, ToolContext } from './types.js';
