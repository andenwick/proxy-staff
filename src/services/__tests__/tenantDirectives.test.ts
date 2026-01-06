import * as fs from 'fs';
import * as path from 'path';
import { TenantDirectivesService } from '../tenantDirectives.js';

// Get project root (where tenants/ folder should be)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEST_TENANT_ID = 'template'; // Use template folder for testing

describe('Task Group 2: Tenant Directives Service', () => {
  let service: TenantDirectivesService;

  beforeEach(() => {
    service = new TenantDirectivesService();
  });

  describe('loadSystemPrompt', () => {
    it('returns README.md content for existing tenant folder', async () => {
      const result = await service.loadSystemPrompt(TEST_TENANT_ID);

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('System Prompt');
      // Verify it contains expected template content
      expect(result).toContain('helpful assistant');
    });

    it('returns null for missing tenant folder', async () => {
      const result = await service.loadSystemPrompt('non-existent-tenant-12345');

      expect(result).toBeNull();
    });
  });

  describe('listDirectives', () => {
    it('returns array of directive names (without .md extension)', async () => {
      const result = await service.listDirectives(TEST_TENANT_ID);

      expect(Array.isArray(result)).toBe(true);
      // Template folder has README.md in directives
      expect(result).toContain('README');
      // Verify extensions are stripped
      for (const name of result) {
        expect(name).not.toContain('.md');
      }
    });
  });

  describe('loadDirective', () => {
    it('loads specific directive by name', async () => {
      const result = await service.loadDirective(TEST_TENANT_ID, 'README');

      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
      expect(result).toContain('System Prompt');
    });

    it('returns null for non-existent directive', async () => {
      const result = await service.loadDirective(TEST_TENANT_ID, 'non-existent-directive');

      expect(result).toBeNull();
    });
  });
});
