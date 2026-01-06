import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TenantFolderService } from '../tenantFolder.js';

// Get project root (where tenants/ folder should be)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEMPLATE_DIR = path.join(TENANTS_DIR, 'template');

/**
 * Helper to construct tenant folder path from UUID
 */
function getTenantFolderPath(tenantId: string): string {
  return path.join(TENANTS_DIR, tenantId);
}

describe('Task Group 1: Tenant Folder Structure', () => {
  describe('Tenant folder path construction', () => {
    it('constructs tenant folder path correctly from UUID', () => {
      const tenantId = 'abc123-def456-uuid';
      const expectedPath = path.join(TENANTS_DIR, tenantId);

      const result = getTenantFolderPath(tenantId);

      expect(result).toBe(expectedPath);
      expect(result).toContain('tenants');
      expect(result).toContain(tenantId);
    });
  });

  describe('Template folder structure validation', () => {
    it('template folder contains all required starter files', () => {
      // Check template folder exists
      expect(fs.existsSync(TEMPLATE_DIR)).toBe(true);

      // Check required directories exist
      const directivesDir = path.join(TEMPLATE_DIR, 'directives');
      const executionDir = path.join(TEMPLATE_DIR, 'execution');
      expect(fs.existsSync(directivesDir)).toBe(true);
      expect(fs.existsSync(executionDir)).toBe(true);

      // Check required files exist
      const requiredFiles = [
        path.join(directivesDir, 'README.md'),
        path.join(executionDir, 'tool_manifest.json'),
        path.join(executionDir, 'example_tool.py'),
        path.join(TEMPLATE_DIR, '.env.example'),
      ];

      for (const filePath of requiredFiles) {
        expect(fs.existsSync(filePath)).toBe(true);
      }

      // Verify tool_manifest.json is valid JSON with tools array
      const manifestContent = fs.readFileSync(
        path.join(executionDir, 'tool_manifest.json'),
        'utf-8'
      );
      const manifest = JSON.parse(manifestContent);
      expect(manifest).toHaveProperty('tools');
      expect(Array.isArray(manifest.tools)).toBe(true);
    });
  });

  describe('File and folder existence checks', () => {
    it('correctly identifies existing and non-existing paths', () => {
      // Existing paths
      expect(fs.existsSync(TENANTS_DIR)).toBe(true);
      expect(fs.existsSync(TEMPLATE_DIR)).toBe(true);

      // Non-existing tenant folder (random UUID that doesn't exist)
      const nonExistentTenant = getTenantFolderPath('non-existent-tenant-uuid-12345');
      expect(fs.existsSync(nonExistentTenant)).toBe(false);

      // Verify we can check directory vs file
      const templateStats = fs.statSync(TEMPLATE_DIR);
      expect(templateStats.isDirectory()).toBe(true);

      const readmePath = path.join(TEMPLATE_DIR, 'directives', 'README.md');
      const readmeStats = fs.statSync(readmePath);
      expect(readmeStats.isFile()).toBe(true);
    });
  });
});

// TenantFolderService tests using temp directories
describe('TenantFolderService', () => {
  let service: TenantFolderService;
  let tempDir: string;
  const mockTenantId = 'test-tenant-123';

  beforeEach(() => {
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-test-'));
    service = new TenantFolderService(tempDir);

    // Create tenant folder structure
    const tenantDir = path.join(tempDir, 'tenants', mockTenantId);
    const directivesDir = path.join(tenantDir, 'directives');
    const executionDir = path.join(tenantDir, 'execution');

    fs.mkdirSync(directivesDir, { recursive: true });
    fs.mkdirSync(executionDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getTenantFolder', () => {
    it('returns correct tenant folder path', () => {
      const result = service.getTenantFolder(mockTenantId);
      expect(result).toBe(path.join(tempDir, 'tenants', mockTenantId));
    });
  });

  describe('tenantFolderExists', () => {
    it('returns true when tenant folder exists', async () => {
      const result = await service.tenantFolderExists(mockTenantId);
      expect(result).toBe(true);
    });

    it('returns false when tenant folder does not exist', async () => {
      const result = await service.tenantFolderExists('non-existent-tenant');
      expect(result).toBe(false);
    });
  });

  describe('ensureClaudeMd', () => {
    it('generates CLAUDE.md from directives/README.md with WhatsApp instructions', async () => {
      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);
      const directivesContent = '# System Prompt\n\nYou are an AI assistant.';

      // Write directives/README.md
      fs.writeFileSync(
        path.join(tenantDir, 'directives', 'README.md'),
        directivesContent
      );

      await service.ensureClaudeMd(mockTenantId);

      // Verify CLAUDE.md was created
      const claudeMdPath = path.join(tenantDir, 'CLAUDE.md');
      expect(fs.existsSync(claudeMdPath)).toBe(true);

      // Verify content includes original directives
      const writtenContent = fs.readFileSync(claudeMdPath, 'utf-8');
      expect(writtenContent).toContain('# System Prompt');
      expect(writtenContent).toContain('You are an AI assistant.');

      // Verify WhatsApp style instructions are included
      expect(writtenContent).toContain('WhatsApp');
    });

    it('handles missing directives/README.md gracefully', async () => {
      // Remove the directives folder
      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);
      fs.rmSync(path.join(tenantDir, 'directives'), { recursive: true, force: true });

      // Should not throw
      await expect(service.ensureClaudeMd(mockTenantId)).resolves.not.toThrow();

      // Should create CLAUDE.md with default content
      const claudeMdPath = path.join(tenantDir, 'CLAUDE.md');
      expect(fs.existsSync(claudeMdPath)).toBe(true);
    });
  });

  describe('generateSettingsJson', () => {
    it('generates .claude/settings.local.json with all required permissions', async () => {
      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);
      const executionDir = path.join(tenantDir, 'execution');

      // Create some Python tools
      fs.writeFileSync(path.join(executionDir, 'tool1.py'), '# tool 1');
      fs.writeFileSync(path.join(executionDir, 'tool2.py'), '# tool 2');
      fs.writeFileSync(path.join(executionDir, 'readme.txt'), 'not a python file');

      await service.generateSettingsJson(mockTenantId);

      // Verify .claude directory was created
      const claudeDir = path.join(tenantDir, '.claude');
      expect(fs.existsSync(claudeDir)).toBe(true);

      // Verify settings.local.json was created
      const settingsPath = path.join(claudeDir, 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      // Verify settings content
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.permissions.allow).toContain('Bash(python execution/*.py:*)');
      expect(settings.permissions.allow).toContain('Bash(python shared_tools/*.py:*)');
      expect(settings.permissions.allow).toContain('WebFetch(*)');
      expect(settings.permissions.allow).toContain('Read(*)');
      expect(settings.permissions.allow).toContain('Write(*)');
      expect(settings.permissions.allow).toContain('Glob(*)');
      expect(settings.permissions.allow).toContain('Grep(*)');
    });

    it('handles missing execution folder gracefully', async () => {
      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);

      // Remove execution folder
      fs.rmSync(path.join(tenantDir, 'execution'), { recursive: true, force: true });

      // Should not throw
      await expect(service.generateSettingsJson(mockTenantId)).resolves.not.toThrow();

      // Should still create settings file
      const settingsPath = path.join(tenantDir, '.claude', 'settings.local.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
    });
  });

  describe('setupSharedTools', () => {
    it('creates shared_tools directory', async () => {
      await service.setupSharedTools(mockTenantId);

      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);
      const sharedToolsDir = path.join(tenantDir, 'shared_tools');
      expect(fs.existsSync(sharedToolsDir)).toBe(true);
    });
  });

  describe('initializeTenantForCli', () => {
    it('creates tenant folder if it does not exist', async () => {
      const newTenantId = 'new-tenant-test';
      const newTenantDir = path.join(tempDir, 'tenants', newTenantId);

      expect(fs.existsSync(newTenantDir)).toBe(false);
      await service.initializeTenantForCli(newTenantId);
      expect(fs.existsSync(newTenantDir)).toBe(true);
    });

    it('orchestrates all setup functions when tenant folder exists', async () => {
      const tenantDir = path.join(tempDir, 'tenants', mockTenantId);

      // Create directives/README.md
      fs.writeFileSync(
        path.join(tenantDir, 'directives', 'README.md'),
        '# Test System Prompt'
      );

      await service.initializeTenantForCli(mockTenantId);

      // Verify all artifacts were created
      expect(fs.existsSync(path.join(tenantDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tenantDir, '.claude', 'settings.local.json'))).toBe(true);
      expect(fs.existsSync(path.join(tenantDir, 'shared_tools'))).toBe(true);
    });
  });
});
