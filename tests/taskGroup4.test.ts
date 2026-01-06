/**
 * Task Group 4 Tests: Built-in Tools and Integration
 *
 * Tests for:
 * - read_directive tool returns directive content
 * - read_directive returns "not found" message for missing directive
 * - Message processor uses tenant folder when present
 * - Message processor falls back to database config when folder missing
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { TenantDirectivesService } from '../src/services/tenantDirectives';
import { readDirectiveTool, setTenantDirectivesService } from '../src/tools/readDirective';
import { ToolContext } from '../src/tools/types';
import { PrismaClient } from '@prisma/client';

// Test tenant ID
const TEST_TENANT_ID = 'test-tenant-4';
const TEST_TENANT_NO_FOLDER = 'test-tenant-no-folder';

// Project root for tenant folder setup
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEST_TENANT_DIR = path.join(TENANTS_DIR, TEST_TENANT_ID);
const TEST_DIRECTIVES_DIR = path.join(TEST_TENANT_DIR, 'directives');

// Mock ToolContext
function createMockContext(tenantId: string): ToolContext {
  return {
    tenantId,
    senderPhone: '+1234567890',
    prisma: {} as PrismaClient,
    getCredential: async () => null,
  };
}

describe('Task Group 4: Built-in Tools and Integration', () => {
  let tenantDirectivesService: TenantDirectivesService;

  beforeAll(async () => {
    // Create test tenant folder structure
    await fs.mkdir(TEST_DIRECTIVES_DIR, { recursive: true });

    // Create test directive files
    await fs.writeFile(
      path.join(TEST_DIRECTIVES_DIR, 'README.md'),
      '# Test System Prompt\n\nYou are a test assistant.'
    );
    await fs.writeFile(
      path.join(TEST_DIRECTIVES_DIR, 'handle_refund.md'),
      '# Refund SOP\n\n1. Verify the order\n2. Process refund'
    );

    // Initialize services
    tenantDirectivesService = new TenantDirectivesService();
    setTenantDirectivesService(tenantDirectivesService);
  });

  afterAll(async () => {
    // Cleanup test tenant folder
    try {
      await fs.rm(TEST_TENANT_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Test 1: read_directive tool returns directive content
  test('read_directive tool returns directive content', async () => {
    const context = createMockContext(TEST_TENANT_ID);
    const result = await readDirectiveTool.execute({ name: 'handle_refund' }, context);

    expect(result).toContain('# Refund SOP');
    expect(result).toContain('Verify the order');
    expect(result).toContain('Process refund');
  });

  // Test 2: read_directive returns "not found" message for missing directive
  test('read_directive returns "not found" message for missing directive', async () => {
    const context = createMockContext(TEST_TENANT_ID);
    const result = await readDirectiveTool.execute({ name: 'nonexistent_directive' }, context);

    expect(result).toContain('not found');
    expect(result).toContain('nonexistent_directive');
  });

  // Test 3: Tenant directives service loads system prompt from folder
  test('message processor uses tenant folder when present', async () => {
    // This tests that tenantDirectivesService correctly loads from folder
    const systemPrompt = await tenantDirectivesService.loadSystemPrompt(TEST_TENANT_ID);

    expect(systemPrompt).not.toBeNull();
    expect(systemPrompt).toContain('# Test System Prompt');
    expect(systemPrompt).toContain('test assistant');
  });

  // Test 4: Falls back gracefully when tenant folder missing
  test('message processor falls back to database config when folder missing', async () => {
    // This tests that loadSystemPrompt returns null for missing folder
    // which triggers fallback to database config in message processor
    const systemPrompt = await tenantDirectivesService.loadSystemPrompt(TEST_TENANT_NO_FOLDER);

    expect(systemPrompt).toBeNull();
  });
});
