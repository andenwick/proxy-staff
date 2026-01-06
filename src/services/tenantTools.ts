import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { PythonRunnerService } from './pythonRunner.js';
import { validateTenantId } from '../utils/validation.js';

// Cache entry with timestamp for TTL
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

// 5-minute TTL in milliseconds
const CACHE_TTL_MS = 5 * 60 * 1000;

// Get project root for tenant folder resolution
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');

// Tool definition as stored in manifest
interface ManifestTool {
  name: string;
  description: string;
  script: string;
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tool manifest structure
interface ToolManifest {
  tools: ManifestTool[];
}

// Validated tool definition with resolved script path
export interface TenantTool {
  name: string;
  description: string;
  script: string;
  scriptPath: string; // Absolute path to script
  input_schema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tool executor type - executes a tool by name with given input
export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>
) => Promise<string>;

export class TenantToolsService {
  private pythonRunner: PythonRunnerService;
  private toolsCache: Map<string, CacheEntry<TenantTool[]>> = new Map();

  constructor(pythonRunner: PythonRunnerService) {
    this.pythonRunner = pythonRunner;
  }

  /**
   * Check if cache entry is still valid (within TTL)
   */
  private isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * Get tenant execution folder path
   * @throws Error if tenant ID is invalid (path traversal prevention)
   */
  private getExecutionPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(TENANTS_DIR, tenantId, 'execution');
  }

  /**
   * Get tenant .env file path
   */
  private getEnvPath(tenantId: string): string {
    return path.join(TENANTS_DIR, tenantId, '.env');
  }

  /**
   * Validate a single tool definition
   * Returns null if invalid, with warning logged
   */
  private validateTool(tool: unknown, executionPath: string): TenantTool | null {
    // Type guard for basic object
    if (!tool || typeof tool !== 'object') {
      logger.warn({ tool }, 'Invalid tool: not an object');
      return null;
    }

    const t = tool as Record<string, unknown>;

    // Check required fields
    if (typeof t.name !== 'string' || !t.name.trim()) {
      logger.warn({ tool }, 'Invalid tool: missing or empty name');
      return null;
    }

    if (typeof t.description !== 'string' || !t.description.trim()) {
      logger.warn({ toolName: t.name }, 'Invalid tool: missing or empty description');
      return null;
    }

    if (typeof t.script !== 'string' || !t.script.trim()) {
      logger.warn({ toolName: t.name }, 'Invalid tool: missing or empty script');
      return null;
    }

    if (!t.input_schema || typeof t.input_schema !== 'object') {
      logger.warn({ toolName: t.name }, 'Invalid tool: missing or invalid input_schema');
      return null;
    }

    const inputSchema = t.input_schema as Record<string, unknown>;
    if (inputSchema.type !== 'object') {
      logger.warn({ toolName: t.name }, 'Invalid tool: input_schema.type must be "object"');
      return null;
    }

    // Verify script file exists
    const scriptPath = path.join(executionPath, t.script as string);
    if (!fsSync.existsSync(scriptPath)) {
      logger.warn(
        { toolName: t.name, scriptPath },
        'Invalid tool: script file does not exist'
      );
      return null;
    }

    // Return validated tool
    return {
      name: t.name as string,
      description: t.description as string,
      script: t.script as string,
      scriptPath,
      input_schema: t.input_schema as TenantTool['input_schema'],
    };
  }

  /**
   * Load tenant tools from tool_manifest.json
   * Returns empty array for missing tenant folder or invalid manifest
   */
  async loadTenantTools(tenantId: string): Promise<TenantTool[]> {
    // Check cache first
    const cached = this.toolsCache.get(tenantId);
    if (this.isCacheValid(cached)) {
      return cached.value;
    }

    const executionPath = this.getExecutionPath(tenantId);
    const manifestPath = path.join(executionPath, 'tool_manifest.json');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      let manifest: ToolManifest;

      try {
        manifest = JSON.parse(content);
      } catch (parseError) {
        logger.error({ tenantId, manifestPath, error: parseError }, 'Invalid JSON in tool_manifest.json');
        return [];
      }

      // Validate manifest structure
      if (!manifest.tools || !Array.isArray(manifest.tools)) {
        logger.error({ tenantId }, 'Invalid manifest: missing or invalid tools array');
        return [];
      }

      // Validate each tool, skip invalid ones
      const validTools: TenantTool[] = [];
      for (const tool of manifest.tools) {
        const validated = this.validateTool(tool, executionPath);
        if (validated) {
          validTools.push(validated);
        }
      }

      // Cache the result
      this.toolsCache.set(tenantId, {
        value: validTools,
        timestamp: Date.now(),
      });

      logger.info(
        { tenantId, toolCount: validTools.length, skipped: manifest.tools.length - validTools.length },
        'Loaded tenant tools'
      );

      return validTools;
    } catch (error) {
      // Folder or file doesn't exist - graceful fallback
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ tenantId, manifestPath }, 'Tool manifest not found, returning empty array');
        return [];
      }
      // Log unexpected errors but still return empty array
      logger.error({ tenantId, error }, 'Error loading tool manifest');
      return [];
    }
  }

  /**
   * Get a tool executor function for a specific tenant.
   * The executor invokes Python scripts with the tenant's environment.
   */
  getTenantToolExecutor(tenantId: string): ToolExecutor {
    const envPath = this.getEnvPath(tenantId);

    return async (toolName: string, input: Record<string, unknown>): Promise<string> => {
      // Load tools to get script path
      const tools = await this.loadTenantTools(tenantId);
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        throw new Error(`Tool "${toolName}" not found for tenant ${tenantId}`);
      }

      logger.info(
        { tenantId, toolName, scriptPath: tool.scriptPath },
        'Executing tenant tool'
      );

      // Execute the Python script
      return this.pythonRunner.runPythonScript(tool.scriptPath, input, envPath);
    };
  }

  /**
   * Clear all caches (useful for testing or manual cache invalidation)
   */
  clearCache(): void {
    this.toolsCache.clear();
  }
}
