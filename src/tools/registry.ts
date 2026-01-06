import { Tool, ToolContext } from './types.js';
import { logger } from '../utils/logger.js';

/**
 * Tool registry for managing available tools.
 */
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool in the registry.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      logger.warn({ toolName: tool.name }, 'Tool already registered, overwriting');
    }
    this.tools.set(tool.name, tool);
    logger.info({ toolName: tool.name }, 'Tool registered');
  }

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Execute a tool by name.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return await tool.execute(input, context);
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
