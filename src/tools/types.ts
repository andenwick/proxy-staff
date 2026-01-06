import { PrismaClient } from '@prisma/client';

/**
 * Context passed to tools during execution.
 * Provides access to tenant credentials and other resources.
 */
export interface ToolContext {
  tenantId: string;
  senderPhone: string;
  prisma: PrismaClient;
  getCredential: (serviceName: string) => Promise<string | null>;
}

/**
 * Tool definition for the registry.
 * Includes both the Claude API schema and the execution function.
 */
export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>;
}
