#!/usr/bin/env node
/**
 * Tool Manifest MCP Server
 *
 * Exposes tools defined in tool_manifest.json as MCP tools for Claude CLI.
 * Each tool call spawns the corresponding Python script with JSON input via stdin.
 *
 * Usage:
 *   TENANT_FOLDER=/path/to/tenant npx tsx src/mcp/toolManifestServer.ts
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import pino from 'pino';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { handleMemoryRead, handleMemoryWrite } from './memoryHandlers.js';

// MCP servers must log to stderr (stdout is reserved for JSON-RPC protocol)
// Use simple JSON logging to avoid pino-pretty transport issues in production
const mcpLogger = pino(
  { name: 'mcp-server', level: 'debug' },
  pino.destination(2) // stderr file descriptor
);

// Startup debug logging
mcpLogger.info({
  TENANT_FOLDER: process.env.TENANT_FOLDER,
  cwd: process.cwd(),
  nodeVersion: process.version,
  pid: process.pid
}, 'MCP Server starting');

// Tool definition from tool_manifest.json
interface ToolDefinition {
  name: string;
  description: string;
  script: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolManifest {
  tools: ToolDefinition[];
}

// Configuration
const TOOL_TIMEOUT_MS = 60000; // 60 seconds
const TENANT_FOLDER = process.env.TENANT_FOLDER || process.cwd();
const DATABASE_URL = process.env.DATABASE_URL;

// Extract tenant_id from folder path (last directory component)
const TENANT_ID = path.basename(TENANT_FOLDER);

// Initialize Prisma client if DATABASE_URL is available
let prisma: PrismaClient | null = null;
if (DATABASE_URL) {
  // Prisma reads DATABASE_URL from process.env automatically
  prisma = new PrismaClient();
  mcpLogger.info({ tenantId: TENANT_ID }, 'Prisma client initialized for memory tools');
} else {
  mcpLogger.warn('DATABASE_URL not set - memory tools will be unavailable');
}

// Built-in memory tools (not from manifest)
const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: 'memory_read',
    description: 'Read persistent memory that survives across sessions. Types: identity, boundaries, patterns, relationships, questions, or any custom type.',
    script: '', // Built-in, not a Python script
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type to read (e.g., "identity", "patterns", "boundaries")' },
        path: { type: 'string', description: 'Optional dot-notation path to specific field (e.g., "preferences.timezone")' },
        query: { type: 'string', description: 'Optional search term to find in data' },
      },
      required: ['type'],
    },
  },
  {
    name: 'memory_write',
    description: 'Write to persistent memory that survives across sessions. Operations: set (replace), merge (deep merge), append (add to array), remove (remove from array).',
    script: '', // Built-in, not a Python script
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Memory type to update' },
        operation: { type: 'string', enum: ['set', 'merge', 'append', 'remove'], description: 'set: replace value, merge: deep merge, append: add to array, remove: remove from array' },
        path: { type: 'string', description: 'Optional dot-notation path for nested operations' },
        value: { description: 'Value to set/merge/append or item to remove' },
        markdown: { type: 'string', description: 'Optional markdown content to append' },
      },
      required: ['type', 'operation'],
    },
  },
];

/**
 * Load tenant-specific environment variables from .env file
 */
function loadTenantEnv(): Record<string, string> {
  const envPath = path.join(TENANT_FOLDER, '.env');
  const tenantEnv: Record<string, string> = {};

  mcpLogger.info({ envPath, TENANT_FOLDER, exists: fs.existsSync(envPath) }, 'Loading tenant .env');

  if (fs.existsSync(envPath)) {
    const result = loadDotenv({ path: envPath });
    if (result.parsed) {
      Object.assign(tenantEnv, result.parsed);
      mcpLogger.info({ envPath, keys: Object.keys(result.parsed) }, 'Loaded tenant .env');
    } else {
      mcpLogger.warn({ envPath }, 'Dotenv parsed but no keys found');
    }
  } else {
    mcpLogger.warn({ envPath, TENANT_FOLDER }, 'No tenant .env file found');
  }

  return tenantEnv;
}

// Note: tenantEnv is loaded fresh on each tool call to pick up credential changes

/**
 * Load tool manifest from tenant folder
 */
function loadToolManifest(): ToolManifest {
  const manifestPath = path.join(TENANT_FOLDER, 'execution', 'tool_manifest.json');

  mcpLogger.debug({
    TENANT_FOLDER,
    manifestPath,
    tenantFolderExists: fs.existsSync(TENANT_FOLDER),
    executionFolderExists: fs.existsSync(path.join(TENANT_FOLDER, 'execution'))
  }, 'Looking for tool manifest');

  if (!fs.existsSync(manifestPath)) {
    mcpLogger.warn({ manifestPath }, 'Tool manifest not found');
    return { tools: [] };
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ToolManifest;
    mcpLogger.info({ toolCount: manifest.tools.length, toolNames: manifest.tools.map(t => t.name) }, 'Loaded tools from manifest');
    return manifest;
  } catch (error) {
    mcpLogger.error({ error }, 'Failed to parse tool manifest');
    return { tools: [] };
  }
}

/**
 * Execute a Python script with JSON input
 */
function executePythonScript(
  scriptPath: string,
  input: Record<string, unknown>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(TENANT_FOLDER, 'execution', scriptPath);

    mcpLogger.info({ scriptPath, fullPath, TENANT_FOLDER }, 'Executing Python script');

    if (!fs.existsSync(fullPath)) {
      reject(new Error(`Script not found: ${scriptPath}`));
      return;
    }

    // Reload tenant env on each call to pick up credential changes
    const freshEnv = loadTenantEnv();

    mcpLogger.info({ freshEnvKeys: Object.keys(freshEnv), TENANT_FOLDER }, 'Passing env to Python');

    const proc = spawn('python', [fullPath], {
      cwd: TENANT_FOLDER,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...freshEnv,  // Tenant-specific env from .env file (reloaded fresh)
        TENANT_FOLDER,
      },
    });

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Script timed out after ${TOOL_TIMEOUT_MS}ms: ${scriptPath}`));
    }, TOOL_TIMEOUT_MS);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve(stdout.trim() || 'Success (no output)');
      } else {
        const errorMsg = stderr.trim() || stdout.trim() || `Exit code ${code}`;
        reject(new Error(`Script failed: ${errorMsg}`));
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn script: ${error.message}`));
    });

    // Write JSON input to stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Load tool manifest
  const manifest = loadToolManifest();

  // Create MCP server
  const server = new Server(
    {
      name: 'tool-manifest-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list_tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Combine built-in tools with manifest tools
    const allTools = [
      // Built-in memory tools (only if DATABASE_URL is available)
      ...(prisma ? BUILTIN_TOOLS : []),
      // Manifest tools
      ...manifest.tools,
    ];

    return {
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    };
  });

  // Handle call_tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Handle built-in memory tools first
    if (name === 'memory_read' || name === 'memory_write') {
      if (!prisma) {
        return {
          content: [{ type: 'text', text: 'Error: Memory tools unavailable - DATABASE_URL not configured' }],
          isError: true,
        };
      }

      mcpLogger.info({ toolName: name, tenantId: TENANT_ID }, 'Executing built-in memory tool');

      if (name === 'memory_read') {
        return handleMemoryRead(args || {}, TENANT_ID, prisma);
      } else {
        return handleMemoryWrite(args || {}, TENANT_ID, prisma);
      }
    }

    // Find tool definition in manifest
    const tool = manifest.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      mcpLogger.info({ toolName: name }, 'Executing tool');
      const result = await executePythonScript(tool.script, args || {});
      mcpLogger.info({ toolName: name }, 'Tool completed successfully');

      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      mcpLogger.error({ toolName: name, error: errorMsg }, 'Tool failed');

      return {
        content: [{ type: 'text', text: `Error: ${errorMsg}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  mcpLogger.info({ toolCount: manifest.tools.length }, 'Tool Manifest Server running');
}

main().catch((error) => {
  mcpLogger.fatal({ error }, 'Fatal error');
  process.exit(1);
});
