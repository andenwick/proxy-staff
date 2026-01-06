/**
 * Task Group 6: Gap Analysis Tests
 *
 * Strategic tests to fill critical coverage gaps identified during review.
 * These tests focus on error handling and edge cases not covered by Task Groups 1-5.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TenantDirectivesService } from '../src/services/tenantDirectives';
import { TenantToolsService } from '../src/services/tenantTools';
import { PythonRunnerService } from '../src/services/pythonRunner';
import { readDirectiveTool, setTenantDirectivesService } from '../src/tools/readDirective';
import { ToolContext } from '../src/tools/types';
import { PrismaClient } from '@prisma/client';

// Project root for tenant folder setup
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');

// Mock ToolContext
function createMockContext(tenantId: string): ToolContext {
  return {
    tenantId,
    senderPhone: '+1234567890',
    prisma: {} as PrismaClient,
    getCredential: async () => null,
  };
}

describe('Task Group 6: Gap Analysis Tests', () => {
  let tenantDirectivesService: TenantDirectivesService;
  let pythonRunner: PythonRunnerService;
  let tenantToolsService: TenantToolsService;

  beforeAll(() => {
    tenantDirectivesService = new TenantDirectivesService();
    pythonRunner = new PythonRunnerService();
    tenantToolsService = new TenantToolsService(pythonRunner);
    setTenantDirectivesService(tenantDirectivesService);
  });

  // Gap Test 1: Tool executor throws error for non-existent tool name
  describe('TenantToolsService error handling', () => {
    test('getTenantToolExecutor throws error for non-existent tool name', async () => {
      const testTenantDir = path.join(TENANTS_DIR, 'test_gap_executor');
      const executionDir = path.join(testTenantDir, 'execution');

      try {
        // Create a tenant with one valid tool
        fs.mkdirSync(executionDir, { recursive: true });
        const manifest = {
          tools: [
            {
              name: 'existing_tool',
              description: 'A tool that exists',
              script: 'existing.py',
              input_schema: { type: 'object', properties: {} },
            },
          ],
        };
        fs.writeFileSync(
          path.join(executionDir, 'tool_manifest.json'),
          JSON.stringify(manifest, null, 2)
        );
        fs.writeFileSync(
          path.join(executionDir, 'existing.py'),
          '#!/usr/bin/env python3\nimport sys\nimport json\nprint(json.dumps({"ok": true}))'
        );

        // Get executor and try to execute a non-existent tool
        const executor = tenantToolsService.getTenantToolExecutor('test_gap_executor');

        await expect(
          executor('nonexistent_tool', { test: true })
        ).rejects.toThrow(/not found/i);
      } finally {
        fs.rmSync(testTenantDir, { recursive: true, force: true });
        tenantToolsService.clearCache();
      }
    });
  });

  // Gap Test 2: Empty tools manifest returns empty array
  describe('Empty manifest handling', () => {
    test('loadTenantTools returns empty array for manifest with no tools', async () => {
      const testTenantDir = path.join(TENANTS_DIR, 'test_gap_empty');
      const executionDir = path.join(testTenantDir, 'execution');

      try {
        fs.mkdirSync(executionDir, { recursive: true });
        const manifest = { tools: [] };
        fs.writeFileSync(
          path.join(executionDir, 'tool_manifest.json'),
          JSON.stringify(manifest, null, 2)
        );

        const tools = await tenantToolsService.loadTenantTools('test_gap_empty');

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBe(0);
      } finally {
        fs.rmSync(testTenantDir, { recursive: true, force: true });
        tenantToolsService.clearCache();
      }
    });
  });

  // Gap Test 3: listDirectives returns empty array for non-existent tenant
  describe('TenantDirectivesService graceful fallbacks', () => {
    test('listDirectives returns empty array for non-existent tenant folder', async () => {
      const result = await tenantDirectivesService.listDirectives('nonexistent-tenant-xyz-123');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  // Gap Test 4: read_directive handles invalid input gracefully
  describe('read_directive input validation', () => {
    test('read_directive returns error message for missing name input', async () => {
      const context = createMockContext('test-tenant');

      // Pass empty object (missing 'name' field)
      const result = await readDirectiveTool.execute({}, context);

      expect(result).toContain('Error');
      expect(result).toContain('required');
    });

    test('read_directive returns error message for invalid name type', async () => {
      const context = createMockContext('test-tenant');

      // Pass number instead of string for 'name'
      const result = await readDirectiveTool.execute({ name: 123 as unknown as string }, context);

      expect(result).toContain('Error');
      expect(result).toContain('required');
    });
  });
});
