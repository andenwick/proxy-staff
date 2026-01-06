import { Tool, ToolContext } from './types.js';
import { TenantDirectivesService } from '../services/tenantDirectives.js';

// Singleton instance - will be set by service initialization
let tenantDirectivesService: TenantDirectivesService | null = null;

/**
 * Set the tenant directives service instance.
 * Called during service initialization.
 */
export function setTenantDirectivesService(service: TenantDirectivesService): void {
  tenantDirectivesService = service;
}

/**
 * Built-in tool that reads a specific directive (SOP) for the tenant.
 * Allows Claude to load standard operating procedures on-demand.
 */
export const readDirectiveTool: Tool = {
  name: 'read_directive',
  description:
    'Read a specific directive (standard operating procedure) by name. Use this to load detailed instructions for handling specific situations like refunds, order lookups, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name of the directive to read (without .md extension)',
      },
    },
    required: ['name'],
  },
  execute: async (input: Record<string, unknown>, context: ToolContext): Promise<string> => {
    const name = input.name as string;

    if (!name || typeof name !== 'string') {
      return 'Error: Directive name is required';
    }

    if (!tenantDirectivesService) {
      return 'Error: Tenant directives service not initialized';
    }

    const content = await tenantDirectivesService.loadDirective(context.tenantId, name);

    if (content === null) {
      return `Directive "${name}" not found. Use the available directive list to see what directives exist.`;
    }

    return content;
  },
};
