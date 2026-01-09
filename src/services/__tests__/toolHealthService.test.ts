/**
 * ToolHealthService Tests
 *
 * Tests for tool health checking, manifest validation, alerting, and fix task queueing.
 */

import * as fs from 'fs';
import * as path from 'path';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Mock PythonRunnerService
const mockRunPythonScript = jest.fn();
jest.mock('../pythonRunner.js', () => ({
  PythonRunnerService: jest.fn().mockImplementation(() => ({
    runPythonScript: mockRunPythonScript,
  })),
}));

// Mock TelegramService
const mockSendTextMessage = jest.fn().mockResolvedValue('12345');
jest.mock('../messaging/telegram.js', () => ({
  TelegramService: jest.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
  })),
}));

// Mock Prisma
const mockPrismaCreate = jest.fn().mockResolvedValue({ id: 'test-job-id' });
jest.mock('../prisma.js', () => ({
  getPrismaClient: jest.fn(() => ({
    async_jobs: {
      create: mockPrismaCreate,
    },
  })),
}));

import {
  ToolHealthService,
  validateToolManifest,
  ToolDefinition,
  ToolTestResult,
} from '../toolHealthService.js';

describe('ToolHealthService', () => {
  const testProjectRoot = path.join(process.cwd(), 'test-temp-tool-health');
  const testTenantId = 'test-tenant';
  const tenantsDir = path.join(testProjectRoot, 'tenants');
  const testToolsDir = path.join(tenantsDir, testTenantId, 'execution', 'tools');
  let service: ToolHealthService;

  beforeAll(async () => {
    // Create test directory structure
    await fs.promises.mkdir(testToolsDir, { recursive: true });
    await fs.promises.mkdir(path.join(tenantsDir, '_template', 'execution', 'tools'), { recursive: true });

    // Create .env file for tenant
    await fs.promises.writeFile(
      path.join(tenantsDir, testTenantId, '.env'),
      'TEST_KEY=test_value\n'
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ToolHealthService(testProjectRoot);
  });

  afterAll(async () => {
    // Clean up test directories
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  // =============================================================================
  // Task Group 1: Manifest Validation Tests
  // =============================================================================

  describe('Manifest Validation (Task Group 1)', () => {
    it('validates tool with test_input passes validation', () => {
      const tool: ToolDefinition = {
        name: 'test_tool',
        description: 'A test tool',
        script: 'test_tool.py',
        input_schema: { type: 'object', properties: {} },
        test_input: { key: 'value' },
      };

      const result = validateToolManifest(tool);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('validates tool with skip_test: true passes validation', () => {
      const tool: ToolDefinition = {
        name: 'destructive_tool',
        description: 'A destructive tool',
        script: 'destructive.py',
        input_schema: { type: 'object', properties: {} },
        skip_test: true,
      };

      const result = validateToolManifest(tool);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('validates tool missing both test_input and skip_test fails validation', () => {
      const tool: ToolDefinition = {
        name: 'invalid_tool',
        description: 'An invalid tool',
        script: 'invalid.py',
        input_schema: { type: 'object', properties: {} },
      };

      const result = validateToolManifest(tool);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('test_input');
      expect(result.error).toContain('skip_test');
    });

    it('parses test_chain field correctly for dependent tools', () => {
      const tool: ToolDefinition = {
        name: 'dependent_tool',
        description: 'A tool that depends on another',
        script: 'dependent.py',
        input_schema: { type: 'object', properties: {} },
        test_chain: {
          depends_on: 'parent_tool',
          map_output: 'result.id',
          to_input: 'parent_id',
        },
      };

      const result = validateToolManifest(tool);
      expect(result.valid).toBe(true);
      expect(tool.test_chain?.depends_on).toBe('parent_tool');
      expect(tool.test_chain?.map_output).toBe('result.id');
      expect(tool.test_chain?.to_input).toBe('parent_id');
    });
  });

  // =============================================================================
  // Task Group 2: ToolHealthService Core Tests
  // =============================================================================

  describe('ToolHealthService Core (Task Group 2)', () => {
    beforeEach(async () => {
      // Create a valid tool manifest for testing
      const toolManifest = {
        category: 'test',
        tools: [
          {
            name: 'echo_test',
            description: 'Test echo tool',
            script: 'echo_test.py',
            input_schema: { type: 'object', properties: { message: { type: 'string' } } },
            test_input: { message: 'health check' },
          },
          {
            name: 'skip_tool',
            description: 'Skipped tool',
            script: 'skip.py',
            input_schema: { type: 'object', properties: {} },
            skip_test: true,
          },
        ],
      };

      await fs.promises.writeFile(
        path.join(testToolsDir, 'test_tools.json'),
        JSON.stringify(toolManifest, null, 2)
      );

      // Create the echo script
      const echoScript = `#!/usr/bin/env python3
import sys, json
data = json.loads(sys.stdin.read())
print(json.dumps({"echoed": data.get("message", "")}))
`;
      await fs.promises.writeFile(
        path.join(tenantsDir, testTenantId, 'execution', 'echo_test.py'),
        echoScript
      );
    });

    it('discoverTenants() finds tenant folders with tools', async () => {
      const tenants = await service.discoverTenants();

      expect(tenants).toContain(testTenantId);
      expect(tenants).not.toContain('_template');
    });

    it('loadTenantTools() loads and parses tool manifests', async () => {
      const tools = await service.loadTenantTools(testTenantId);

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.find(t => t.name === 'echo_test')).toBeDefined();
      expect(tools.find(t => t.name === 'skip_tool')).toBeDefined();
    });

    it('testTool() executes tool with test_input via PythonRunner', async () => {
      mockRunPythonScript.mockResolvedValueOnce(JSON.stringify({ echoed: 'health check' }));

      const tool: ToolDefinition = {
        name: 'echo_test',
        description: 'Test echo',
        script: 'echo_test.py',
        input_schema: { type: 'object', properties: {} },
        test_input: { message: 'health check' },
      };

      const result = await service.testTool(testTenantId, tool);

      expect(result.status).toBe('passed');
      expect(result.toolName).toBe('echo_test');
      expect(result.tenantId).toBe(testTenantId);
      expect(mockRunPythonScript).toHaveBeenCalledWith(
        expect.stringContaining('echo_test.py'),
        { message: 'health check' },
        expect.any(String)
      );
    });

    it('testTool() skips tools with skip_test: true', async () => {
      const tool: ToolDefinition = {
        name: 'skip_tool',
        description: 'Skipped tool',
        script: 'skip.py',
        input_schema: { type: 'object', properties: {} },
        skip_test: true,
      };

      const result = await service.testTool(testTenantId, tool);

      expect(result.status).toBe('skipped');
      expect(result.toolName).toBe('skip_tool');
      expect(mockRunPythonScript).not.toHaveBeenCalled();
    });

    it('testTool() resolves test_chain dependencies before execution', async () => {
      // First call returns parent output
      mockRunPythonScript.mockResolvedValueOnce(JSON.stringify({ items: [{ id: 'item-123' }] }));
      // Second call for dependent tool
      mockRunPythonScript.mockResolvedValueOnce(JSON.stringify({ success: true }));

      const parentTool: ToolDefinition = {
        name: 'parent_tool',
        description: 'Parent tool',
        script: 'parent.py',
        input_schema: { type: 'object', properties: {} },
        test_input: { query: 'test' },
      };

      const dependentTool: ToolDefinition = {
        name: 'dependent_tool',
        description: 'Dependent tool',
        script: 'dependent.py',
        input_schema: { type: 'object', properties: {} },
        test_chain: {
          depends_on: 'parent_tool',
          map_output: 'items[0].id',
          to_input: 'item_id',
        },
      };

      // Register parent tool for chain resolution
      service.registerToolForChain(testTenantId, parentTool);

      const result = await service.testTool(testTenantId, dependentTool);

      expect(result.status).toBe('passed');
      // Should have called python runner twice - once for parent, once for dependent
      expect(mockRunPythonScript).toHaveBeenCalledTimes(2);
      // Second call should have the mapped input
      expect(mockRunPythonScript).toHaveBeenLastCalledWith(
        expect.stringContaining('dependent.py'),
        { item_id: 'item-123' },
        expect.any(String)
      );
    });

    it('runFullSuite() returns structured results with passed/failed/skipped counts', async () => {
      mockRunPythonScript.mockResolvedValue(JSON.stringify({ success: true }));

      const results = await service.runFullSuite(testTenantId);

      expect(results).toHaveProperty('passed');
      expect(results).toHaveProperty('failed');
      expect(results).toHaveProperty('skipped');
      expect(results).toHaveProperty('results');
      expect(Array.isArray(results.results)).toBe(true);
      expect(results.passed + results.failed + results.skipped).toBe(results.results.length);
    });
  });

  // =============================================================================
  // Task Group 3: Alerting & Fix Task Queueing Tests
  // =============================================================================

  describe('Alerting & Fix Task Queueing (Task Group 3)', () => {
    let alertService: ToolHealthService;

    beforeEach(() => {
      // Set env vars BEFORE creating service so constructor can see them
      process.env.ADMIN_TELEGRAM_CHAT_ID = 'test-chat-123';
      process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
      // Create a fresh service with the env vars set
      alertService = new ToolHealthService(testProjectRoot);
    });

    afterEach(() => {
      delete process.env.ADMIN_TELEGRAM_CHAT_ID;
      delete process.env.TELEGRAM_BOT_TOKEN;
    });

    it('alertFailure() sends Telegram message to ADMIN_TELEGRAM_CHAT_ID', async () => {
      const failedResult: ToolTestResult = {
        toolName: 'broken_tool',
        tenantId: testTenantId,
        status: 'failed',
        error: 'Connection refused',
        durationMs: 150,
      };

      await alertService.alertFailure(failedResult);

      expect(mockSendTextMessage).toHaveBeenCalledWith(
        'test-chat-123',
        expect.stringContaining('Tool Health Alert')
      );
    });

    it('alert message contains tool name, tenant ID, and truncated error (max 500 chars)', async () => {
      const longError = 'x'.repeat(1000);
      const failedResult: ToolTestResult = {
        toolName: 'broken_tool',
        tenantId: testTenantId,
        status: 'failed',
        error: longError,
        durationMs: 150,
      };

      await alertService.alertFailure(failedResult);

      expect(mockSendTextMessage).toHaveBeenCalled();
      const sentMessage = mockSendTextMessage.mock.calls[0][1] as string;
      expect(sentMessage).toContain('broken_tool');
      expect(sentMessage).toContain(testTenantId);
      // Error should be truncated
      expect(sentMessage.length).toBeLessThan(longError.length);
      expect(sentMessage).toContain('x'.repeat(100)); // Should contain at least part of error
    });

    it('queueFixTask() creates async_jobs record with fix prompt', async () => {
      const failedResult: ToolTestResult = {
        toolName: 'broken_tool',
        tenantId: testTenantId,
        status: 'failed',
        error: 'Authentication failed',
        durationMs: 150,
        scriptPath: 'broken_tool.py',
      };

      await alertService.queueFixTask(failedResult);

      expect(mockPrismaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: testTenantId,
          status: 'PENDING',
          input_message: expect.stringContaining('broken_tool'),
        }),
      });
    });

    it('fix prompt includes tool name, tenant ID, error, and instruction to check code AND credentials', async () => {
      const failedResult: ToolTestResult = {
        toolName: 'broken_tool',
        tenantId: testTenantId,
        status: 'failed',
        error: 'API key invalid',
        durationMs: 150,
        scriptPath: 'broken_tool.py',
      };

      await alertService.queueFixTask(failedResult);

      const createCall = mockPrismaCreate.mock.calls[0][0];
      const fixPrompt = createCall.data.input_message;

      expect(fixPrompt).toContain('broken_tool');
      expect(fixPrompt).toContain(testTenantId);
      expect(fixPrompt).toContain('API key invalid');
      expect(fixPrompt).toContain('tool code');
      expect(fixPrompt).toContain('credentials');
      expect(fixPrompt).toContain('.env');
    });
  });
});
