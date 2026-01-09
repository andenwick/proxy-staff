/**
 * ToolHealthService
 *
 * Automated tool health checking for tenant tools.
 * - Discovers tenants and their tools
 * - Tests tools with test_input or marks them as skipped
 * - Resolves test_chain dependencies
 * - Alerts admin on failures via Telegram
 * - Queues fix tasks for the agent to self-heal
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import lodash from 'lodash';
import { PythonRunnerService } from './pythonRunner.js';
import { TelegramService } from './messaging/telegram.js';
import { getPrismaClient } from './prisma.js';
import { logger as baseLogger } from '../utils/logger.js';

const { get: lodashGet } = lodash;
const logger = baseLogger.child({ module: 'tool-health-service' });

// =============================================================================
// Types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  script: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  // Health check fields
  test_input?: Record<string, unknown>;
  skip_test?: boolean;
  test_chain?: {
    depends_on: string;
    map_output: string;
    to_input: string;
  };
}

export interface ToolManifest {
  category?: string;
  description?: string;
  tools: ToolDefinition[];
}

export interface ToolTestResult {
  toolName: string;
  tenantId: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
  scriptPath?: string;
}

export interface HealthCheckResult {
  passed: number;
  failed: number;
  skipped: number;
  results: ToolTestResult[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a tool definition has proper test configuration.
 */
export function validateToolManifest(tool: ToolDefinition): ValidationResult {
  // Tool must have either test_input, skip_test: true, or test_chain
  const hasTestInput = tool.test_input !== undefined;
  const hasSkipTest = tool.skip_test === true;
  const hasTestChain = tool.test_chain !== undefined;

  if (!hasTestInput && !hasSkipTest && !hasTestChain) {
    return {
      valid: false,
      error: `Tool "${tool.name}" must have either test_input, skip_test: true, or test_chain configured`,
    };
  }

  return { valid: true };
}

// =============================================================================
// Service
// =============================================================================

export class ToolHealthService {
  private projectRoot: string;
  private pythonRunner: PythonRunnerService;
  private telegramService: TelegramService | null = null;
  // Cache for chain resolution: tenantId -> toolName -> tool definition
  private toolCache: Map<string, Map<string, ToolDefinition>> = new Map();
  // Cache for chain results: tenantId -> toolName -> output
  private chainResultCache: Map<string, Map<string, unknown>> = new Map();

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.pythonRunner = new PythonRunnerService();

    // Initialize Telegram if configured
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      this.telegramService = new TelegramService({ botToken });
    }
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Discover all tenants with tool folders.
   * Excludes _template tenant.
   */
  async discoverTenants(): Promise<string[]> {
    const tenantsDir = path.join(this.projectRoot, 'tenants');

    if (!fs.existsSync(tenantsDir)) {
      logger.warn({ tenantsDir }, 'Tenants directory not found');
      return [];
    }

    const entries = await fs.promises.readdir(tenantsDir, { withFileTypes: true });
    const tenants: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '_template') continue;

      const toolsDir = path.join(tenantsDir, entry.name, 'execution', 'tools');
      if (fs.existsSync(toolsDir)) {
        tenants.push(entry.name);
      }
    }

    logger.debug({ tenants }, 'Discovered tenants with tools');
    return tenants;
  }

  /**
   * Load all tools for a tenant from their tool manifest files.
   */
  async loadTenantTools(tenantId: string): Promise<ToolDefinition[]> {
    const toolsDir = path.join(this.projectRoot, 'tenants', tenantId, 'execution', 'tools');

    if (!fs.existsSync(toolsDir)) {
      logger.warn({ tenantId, toolsDir }, 'Tools directory not found for tenant');
      return [];
    }

    const files = await fs.promises.readdir(toolsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const allTools: ToolDefinition[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.promises.readFile(path.join(toolsDir, file), 'utf-8');
        const manifest = JSON.parse(content) as ToolManifest;

        if (manifest.tools && Array.isArray(manifest.tools)) {
          allTools.push(...manifest.tools);
        }
      } catch (error) {
        logger.warn({ tenantId, file, error }, 'Failed to parse tool manifest');
      }
    }

    logger.debug({ tenantId, toolCount: allTools.length }, 'Loaded tenant tools');
    return allTools;
  }

  // ===========================================================================
  // Chain Resolution
  // ===========================================================================

  /**
   * Register a tool for chain resolution.
   * Called before testing dependent tools.
   */
  registerToolForChain(tenantId: string, tool: ToolDefinition): void {
    if (!this.toolCache.has(tenantId)) {
      this.toolCache.set(tenantId, new Map());
    }
    this.toolCache.get(tenantId)!.set(tool.name, tool);
  }

  /**
   * Clear chain caches (call between suite runs).
   */
  clearChainCache(): void {
    this.chainResultCache.clear();
  }

  /**
   * Resolve test_chain dependency and return the merged input.
   */
  private async resolveChain(
    tenantId: string,
    tool: ToolDefinition
  ): Promise<Record<string, unknown>> {
    const chain = tool.test_chain;
    if (!chain) {
      return {};
    }

    const { depends_on, map_output, to_input } = chain;

    // Check if we already have cached result for dependency
    let depOutput = this.chainResultCache.get(tenantId)?.get(depends_on);

    if (!depOutput) {
      // Need to run the dependency first
      const depTool = this.toolCache.get(tenantId)?.get(depends_on);
      if (!depTool) {
        throw new Error(`Dependency tool "${depends_on}" not found for chain resolution`);
      }

      const depResult = await this.testTool(tenantId, depTool);
      if (depResult.status !== 'passed') {
        throw new Error(`Dependency tool "${depends_on}" failed: ${depResult.error}`);
      }

      // Get the cached output
      depOutput = this.chainResultCache.get(tenantId)?.get(depends_on);
    }

    if (!depOutput) {
      throw new Error(`No output cached for dependency "${depends_on}"`);
    }

    // Extract value using lodash get with the map_output path
    const mappedValue = lodashGet(depOutput, map_output);
    if (mappedValue === undefined) {
      throw new Error(`Could not extract "${map_output}" from dependency output`);
    }

    return { [to_input]: mappedValue };
  }

  // ===========================================================================
  // Testing
  // ===========================================================================

  /**
   * Test a single tool.
   */
  async testTool(tenantId: string, tool: ToolDefinition): Promise<ToolTestResult> {
    const startMs = Date.now();

    // Handle skip_test
    if (tool.skip_test) {
      return {
        toolName: tool.name,
        tenantId,
        status: 'skipped',
        scriptPath: tool.script,
      };
    }

    // Build test input
    let testInput: Record<string, unknown> = {};

    // If test_chain, resolve dependencies first
    if (tool.test_chain) {
      try {
        testInput = await this.resolveChain(tenantId, tool);
      } catch (error) {
        return {
          toolName: tool.name,
          tenantId,
          status: 'failed',
          error: `Chain resolution failed: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: Date.now() - startMs,
          scriptPath: tool.script,
        };
      }
    } else if (tool.test_input) {
      testInput = { ...tool.test_input };
    }

    // Build paths
    const scriptPath = path.join(this.projectRoot, 'tenants', tenantId, 'execution', tool.script);
    const envPath = path.join(this.projectRoot, 'tenants', tenantId, '.env');

    try {
      const output = await this.pythonRunner.runPythonScript(scriptPath, testInput, envPath);
      const durationMs = Date.now() - startMs;

      // Cache output for chain resolution
      try {
        const parsedOutput = JSON.parse(output);
        if (!this.chainResultCache.has(tenantId)) {
          this.chainResultCache.set(tenantId, new Map());
        }
        this.chainResultCache.get(tenantId)!.set(tool.name, parsedOutput);
      } catch {
        // Non-JSON output, cache as-is
        if (!this.chainResultCache.has(tenantId)) {
          this.chainResultCache.set(tenantId, new Map());
        }
        this.chainResultCache.get(tenantId)!.set(tool.name, { raw: output });
      }

      logger.info({ tenantId, toolName: tool.name, durationMs }, 'Tool test passed');

      return {
        toolName: tool.name,
        tenantId,
        status: 'passed',
        durationMs,
        scriptPath: tool.script,
      };
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const errorMsg = error instanceof Error ? error.message : String(error);

      logger.error({ tenantId, toolName: tool.name, error: errorMsg, durationMs }, 'Tool test failed');

      return {
        toolName: tool.name,
        tenantId,
        status: 'failed',
        error: errorMsg,
        durationMs,
        scriptPath: tool.script,
      };
    }
  }

  /**
   * Run the full health check suite for one or all tenants.
   */
  async runFullSuite(tenantId?: string): Promise<HealthCheckResult> {
    const results: ToolTestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    // Clear chain cache between suite runs
    this.clearChainCache();

    // Determine which tenants to test
    const tenants = tenantId ? [tenantId] : await this.discoverTenants();

    for (const tenant of tenants) {
      logger.info({ tenantId: tenant }, 'Starting health check for tenant');

      const tools = await this.loadTenantTools(tenant);

      // Register all tools for chain resolution
      for (const tool of tools) {
        this.registerToolForChain(tenant, tool);
      }

      // First pass: test tools without test_chain (these are independent)
      const independentTools = tools.filter(t => !t.test_chain);
      for (const tool of independentTools) {
        const result = await this.testTool(tenant, tool);
        results.push(result);

        if (result.status === 'passed') passed++;
        else if (result.status === 'failed') {
          failed++;
          // Alert and queue fix task for failures
          await this.alertFailure(result);
          await this.queueFixTask(result);
        } else skipped++;
      }

      // Second pass: test tools with test_chain (dependent on first pass)
      const dependentTools = tools.filter(t => t.test_chain);
      for (const tool of dependentTools) {
        const result = await this.testTool(tenant, tool);
        results.push(result);

        if (result.status === 'passed') passed++;
        else if (result.status === 'failed') {
          failed++;
          // Alert and queue fix task for failures
          await this.alertFailure(result);
          await this.queueFixTask(result);
        } else skipped++;
      }

      logger.info({ tenantId: tenant, passed, failed, skipped }, 'Completed health check for tenant');
    }

    return { passed, failed, skipped, results };
  }

  // ===========================================================================
  // Alerting
  // ===========================================================================

  /**
   * Send a Telegram alert for a failed tool.
   */
  async alertFailure(result: ToolTestResult): Promise<void> {
    const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;

    if (!chatId) {
      logger.warn('ADMIN_TELEGRAM_CHAT_ID not configured, skipping alert');
      return;
    }

    if (!this.telegramService) {
      logger.warn('Telegram service not initialized, skipping alert');
      return;
    }

    // Truncate error to 500 chars
    const truncatedError = result.error
      ? result.error.substring(0, 500) + (result.error.length > 500 ? '...' : '')
      : 'Unknown error';

    const message = [
      '<b>Tool Health Alert</b>',
      '',
      `<b>Tool:</b> ${result.toolName}`,
      `<b>Tenant:</b> ${result.tenantId}`,
      `<b>Error:</b> ${truncatedError}`,
    ].join('\n');

    try {
      await this.telegramService.sendTextMessage(chatId, message);
      logger.info({ toolName: result.toolName, tenantId: result.tenantId }, 'Alert sent');
    } catch (error) {
      logger.error({ error }, 'Failed to send alert');
    }
  }

  // ===========================================================================
  // Fix Task Queueing
  // ===========================================================================

  /**
   * Queue a fix task for a failed tool.
   */
  async queueFixTask(result: ToolTestResult): Promise<void> {
    const prisma = getPrismaClient();

    const fixPrompt = [
      `Tool "${result.toolName}" in tenant "${result.tenantId}" is failing health checks.`,
      '',
      `Error: ${result.error || 'Unknown error'}`,
      '',
      'Please diagnose and fix this tool. Check both:',
      `1. The tool code in tenants/${result.tenantId}/execution/${result.scriptPath || result.toolName + '.py'}`,
      `2. The tenant credentials in tenants/${result.tenantId}/.env`,
      '',
      'After fixing, run the health check to verify: POST /admin/tools/health-check',
    ].join('\n');

    try {
      await prisma.async_jobs.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: result.tenantId,
          sender_phone: 'system',
          session_id: 'health-check',
          input_message: fixPrompt,
          estimated_ms: 300000, // 5 minutes
          dedup_hash: `fix-tool-${result.tenantId}-${result.toolName}-${Date.now()}`,
          status: 'PENDING',
        },
      });

      logger.info({ toolName: result.toolName, tenantId: result.tenantId }, 'Fix task queued');
    } catch (error) {
      logger.error({ error }, 'Failed to queue fix task');
    }
  }
}
