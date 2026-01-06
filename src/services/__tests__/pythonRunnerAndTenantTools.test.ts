import * as fs from 'fs';
import * as path from 'path';
import { PythonRunnerService } from '../pythonRunner.js';
import { TenantToolsService } from '../tenantTools.js';

// Get project root (where tenants/ folder should be)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
// NOTE: 'template' (without underscore) is a test folder with example tools for runtime tests
// The '_template' folder (with underscore) is the canonical template for init-tenant script
const TEST_TENANT_ID = 'template';

describe('Task Group 3: Python Runner and Tenant Tools Services', () => {
  describe('PythonRunnerService', () => {
    let pythonRunner: PythonRunnerService;

    beforeEach(() => {
      pythonRunner = new PythonRunnerService();
    });

    it('executes Python script and returns stdout', async () => {
      const scriptPath = path.join(TENANTS_DIR, TEST_TENANT_ID, 'execution', 'example_tool.py');
      const input = { message: 'Test message from Jest' };

      const result = await pythonRunner.runPythonScript(scriptPath, input);

      // example_tool.py returns JSON with status, message, and note
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('success');
      expect(parsed.message).toBe('Test message from Jest');
      expect(parsed.note).toBe('This is an example tool response');
    });

    it('handles 30-second timeout for long-running scripts', async () => {
      // Create a temporary script that would take too long
      const tempScript = path.join(TENANTS_DIR, TEST_TENANT_ID, 'execution', '_temp_slow_script.py');
      const slowScript = `#!/usr/bin/env python3
import time
import sys
import json

# Read input to satisfy contract
input_data = json.loads(sys.stdin.read())

# Sleep for longer than timeout
time.sleep(35)
print("Should never reach here")
`;

      try {
        // Write temporary slow script
        fs.writeFileSync(tempScript, slowScript);

        // Create runner with 1-second timeout for test speed
        const fastTimeoutRunner = new PythonRunnerService(1000);

        await expect(
          fastTimeoutRunner.runPythonScript(tempScript, { test: true })
        ).rejects.toThrow(/timed out|aborted/i);
      } finally {
        // Clean up temporary script
        if (fs.existsSync(tempScript)) {
          fs.unlinkSync(tempScript);
        }
      }
    }, 10000); // Increase Jest timeout for this test
  });

  describe('TenantToolsService', () => {
    let tenantTools: TenantToolsService;
    let pythonRunner: PythonRunnerService;

    beforeEach(() => {
      pythonRunner = new PythonRunnerService();
      tenantTools = new TenantToolsService(pythonRunner);
    });

    it('parses valid tool_manifest.json and returns tool definitions', async () => {
      // First create a test tenant with valid manifest
      const testTenantDir = path.join(TENANTS_DIR, 'test-valid-tools');
      const executionDir = path.join(testTenantDir, 'execution');

      try {
        // Create test tenant folder structure
        fs.mkdirSync(executionDir, { recursive: true });

        // Create a valid tool manifest
        const manifest = {
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool for validation',
              script: 'test_script.py',
              input_schema: {
                type: 'object',
                properties: {
                  param1: { type: 'string', description: 'A test parameter' },
                },
                required: ['param1'],
              },
            },
          ],
        };
        fs.writeFileSync(
          path.join(executionDir, 'tool_manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create the referenced script
        fs.writeFileSync(
          path.join(executionDir, 'test_script.py'),
          '#!/usr/bin/env python3\nimport sys\nimport json\nprint(json.dumps({"result": "ok"}))'
        );

        const tools = await tenantTools.loadTenantTools('test-valid-tools');

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe('test_tool');
        expect(tools[0].description).toBe('A test tool for validation');
        expect(tools[0].input_schema.type).toBe('object');
      } finally {
        // Clean up test folder
        fs.rmSync(testTenantDir, { recursive: true, force: true });
      }
    });

    it('skips invalid tools with warning and continues loading valid ones', async () => {
      const testTenantDir = path.join(TENANTS_DIR, 'test-invalid-tools');
      const executionDir = path.join(testTenantDir, 'execution');

      try {
        fs.mkdirSync(executionDir, { recursive: true });

        // Create manifest with one valid and one invalid tool (missing script file)
        const manifest = {
          tools: [
            {
              name: 'valid_tool',
              description: 'A valid tool',
              script: 'valid_script.py',
              input_schema: {
                type: 'object',
                properties: {},
              },
            },
            {
              name: 'invalid_tool',
              description: 'Tool with missing script',
              script: 'nonexistent_script.py',
              input_schema: {
                type: 'object',
                properties: {},
              },
            },
            {
              // Missing required 'name' field - should be skipped
              description: 'Tool missing name',
              script: 'some_script.py',
              input_schema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        };
        fs.writeFileSync(
          path.join(executionDir, 'tool_manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create only the valid script
        fs.writeFileSync(
          path.join(executionDir, 'valid_script.py'),
          '#!/usr/bin/env python3\nprint("ok")'
        );

        const tools = await tenantTools.loadTenantTools('test-invalid-tools');

        // Should only have the valid tool
        expect(tools.length).toBe(1);
        expect(tools[0].name).toBe('valid_tool');
      } finally {
        fs.rmSync(testTenantDir, { recursive: true, force: true });
      }
    });

    it('executes tenant tool via getTenantToolExecutor with correct script and env', async () => {
      const testTenantDir = path.join(TENANTS_DIR, 'test-executor');
      const executionDir = path.join(testTenantDir, 'execution');

      try {
        fs.mkdirSync(executionDir, { recursive: true });

        // Create a tool manifest
        const manifest = {
          tools: [
            {
              name: 'echo_tool',
              description: 'Echoes input with env var',
              script: 'echo_tool.py',
              input_schema: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                },
              },
            },
          ],
        };
        fs.writeFileSync(
          path.join(executionDir, 'tool_manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        // Create the script that reads input and env
        const scriptContent = `#!/usr/bin/env python3
import sys
import json
import os

input_data = json.loads(sys.stdin.read())
message = input_data.get("message", "default")
env_value = os.environ.get("TEST_ENV_VAR", "not_set")
print(json.dumps({"message": message, "env_value": env_value}))
`;
        fs.writeFileSync(path.join(executionDir, 'echo_tool.py'), scriptContent);

        // Create .env file for the tenant
        fs.writeFileSync(path.join(testTenantDir, '.env'), 'TEST_ENV_VAR=from_tenant_env');

        // Get executor and execute the tool
        const executor = tenantTools.getTenantToolExecutor('test-executor');
        const result = await executor('echo_tool', { message: 'Hello from test' });

        const parsed = JSON.parse(result);
        expect(parsed.message).toBe('Hello from test');
        expect(parsed.env_value).toBe('from_tenant_env');
      } finally {
        fs.rmSync(testTenantDir, { recursive: true, force: true });
      }
    });
  });
});
