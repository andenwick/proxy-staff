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
    return {
      tools: manifest.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
      })),
    };
  });

  // Handle call_tool request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Find tool definition
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
