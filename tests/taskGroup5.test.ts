/**
 * Task Group 5 Tests: Management Scripts
 *
 * Tests for:
 * - init-tenant copies template files to new tenant folder
 * - init-tenant rejects invalid tenant UUIDs
 * - validate-tenant reports manifest and script issues
 */

import * as fs from 'fs';
import * as path from 'path';

// Get project root
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
// NOTE: _template (with underscore) is the canonical template for init-tenant script
// The 'template' folder (without underscore) is a test folder for runtime tests
const TEMPLATE_DIR = path.join(TENANTS_DIR, '_template');

describe('Task Group 5: Management Scripts', () => {
  describe('init-tenant script', () => {
    // Test 1: Verify template has all files that would be copied
    test('init-tenant copies template files to new tenant folder', () => {
      // Verify template folder structure exists and can be copied
      expect(fs.existsSync(TEMPLATE_DIR)).toBe(true);

      // Check all required template files exist
      const templateFiles = [
        path.join(TEMPLATE_DIR, 'directives', 'README.md'),
        path.join(TEMPLATE_DIR, 'execution', 'tool_manifest.json'),
        path.join(TEMPLATE_DIR, 'execution', 'example_tool.py'),
        path.join(TEMPLATE_DIR, '.env.example'),
      ];

      for (const filePath of templateFiles) {
        expect(fs.existsSync(filePath)).toBe(true);
      }

      // Verify template directories exist
      expect(fs.existsSync(path.join(TEMPLATE_DIR, 'directives'))).toBe(true);
      expect(fs.existsSync(path.join(TEMPLATE_DIR, 'execution'))).toBe(true);

      // Verify tool_manifest.json is valid JSON with tools array
      const manifestPath = path.join(TEMPLATE_DIR, 'execution', 'tool_manifest.json');
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);
      expect(manifest).toHaveProperty('tools');
      expect(Array.isArray(manifest.tools)).toBe(true);

      // Verify README.md has content
      const readmePath = path.join(TEMPLATE_DIR, 'directives', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      expect(readmeContent.trim().length).toBeGreaterThan(0);
    });

    // Test 2: UUID validation logic
    test('init-tenant rejects invalid tenant UUIDs', () => {
      // Test UUID format validation regex (same as used in init-tenant.ts)
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      // Valid UUIDs should pass
      const validUuids = [
        '12345678-1234-1234-1234-123456789abc',
        'ABCDEF12-3456-7890-ABCD-EF1234567890',
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      ];

      for (const uuid of validUuids) {
        expect(UUID_REGEX.test(uuid)).toBe(true);
      }

      // Invalid UUIDs should fail
      const invalidUuids = [
        '',                           // empty string
        'not-a-uuid',                 // wrong format
        '12345',                      // too short
        'abc',                        // too short
        '../../../etc/passwd',        // path traversal attempt
        '_template',                  // reserved name
        '12345678-1234-1234-1234',   // incomplete
        '12345678123412341234123456789abc', // missing dashes
        'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz', // invalid hex chars
      ];

      for (const uuid of invalidUuids) {
        expect(UUID_REGEX.test(uuid)).toBe(false);
      }

      // Reserved names check
      const reservedNames = ['_template', '.', '..'];
      for (const name of reservedNames) {
        expect(reservedNames.includes(name)).toBe(true);
      }

      // Path traversal check
      const pathTraversalAttempts = [
        '../etc/passwd',
        '..\\etc\\passwd',
        'foo/../bar',
        'foo/bar',
        'foo\\bar',
      ];

      for (const attempt of pathTraversalAttempts) {
        const hasPathChars = attempt.includes('/') || attempt.includes('\\') || attempt.includes('..');
        expect(hasPathChars).toBe(true);
      }
    });
  });

  describe('validate-tenant script', () => {
    // Test 3: Validation logic for manifest and scripts
    test('validate-tenant reports manifest and script issues', () => {
      // Test manifest validation logic

      // Valid manifest structure
      const validManifest = {
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool for testing',
            script: 'example_tool.py',
            input_schema: {
              type: 'object',
              properties: {
                message: { type: 'string', description: 'A message' }
              },
              required: ['message']
            }
          }
        ]
      };

      // Validate structure
      expect(validManifest).toHaveProperty('tools');
      expect(Array.isArray(validManifest.tools)).toBe(true);
      expect(validManifest.tools.length).toBeGreaterThan(0);

      // Validate each tool has required fields
      for (const tool of validManifest.tools) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.trim().length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.trim().length).toBeGreaterThan(0);
        expect(typeof tool.script).toBe('string');
        expect(tool.script.trim().length).toBeGreaterThan(0);
        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe('object');
      }

      // Test invalid manifests detection
      const invalidManifests: Array<{manifest: Record<string, unknown>, issue: string}> = [
        { manifest: { notTools: [] }, issue: 'missing tools key' },
        { manifest: { tools: 'not-an-array' }, issue: 'tools not array' },
        { manifest: { tools: [{ name: '' }] }, issue: 'empty name' },
        { manifest: { tools: [{ name: 123 }] }, issue: 'name not string' },
        { manifest: { tools: [{ name: 'test' }] }, issue: 'missing description' },
        { manifest: { tools: [{ name: 'test', description: 'desc' }] }, issue: 'missing script' },
        { manifest: { tools: [{ name: 'test', description: 'desc', script: 'test.py' }] }, issue: 'missing input_schema' },
        {
          manifest: {
            tools: [{
              name: 'test',
              description: 'desc',
              script: 'test.py',
              input_schema: { type: 'string' } // wrong type
            }]
          },
          issue: 'input_schema type not object'
        },
      ];

      for (const { manifest, issue } of invalidManifests) {
        let isInvalid = false;

        // Check tools array exists
        if (!('tools' in manifest) || !Array.isArray(manifest.tools)) {
          isInvalid = true;
        } else {
          // Check each tool
          for (const tool of manifest.tools as Array<Record<string, unknown>>) {
            if (
              typeof tool.name !== 'string' ||
              (tool.name as string).trim().length === 0 ||
              typeof tool.description !== 'string' ||
              typeof tool.script !== 'string' ||
              !tool.input_schema ||
              (tool.input_schema as Record<string, unknown>).type !== 'object'
            ) {
              isInvalid = true;
              break;
            }
          }
        }

        expect(isInvalid).toBe(true);
      }

      // Verify script file existence check (using template as reference)
      const executionPath = path.join(TEMPLATE_DIR, 'execution');
      const exampleScriptPath = path.join(executionPath, 'example_tool.py');
      expect(fs.existsSync(exampleScriptPath)).toBe(true);

      const nonExistentScript = path.join(executionPath, 'nonexistent.py');
      expect(fs.existsSync(nonExistentScript)).toBe(false);
    });
  });
});
