import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');
const TEMPLATE_DIR = path.join(TENANTS_DIR, '_template');
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readJson(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function validateToolManifest(manifestPath: string, executionPath: string): void {
  expect(fs.existsSync(manifestPath)).toBe(true);

  const manifest = readJson(manifestPath) as Record<string, unknown>;
  expect(manifest).toBeTruthy();
  expect(Array.isArray(manifest.tools)).toBe(true);

  const tools = manifest.tools as Array<Record<string, unknown>>;
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }
    if (typeof tool.script === 'string' && tool.script.trim()) {
      const scriptPath = path.join(executionPath, tool.script);
      expect(fs.existsSync(scriptPath)).toBe(true);
    }
  }
}

describe('Tenant folder validation (CI-safe)', () => {
  it('template folder contains required files', () => {
    expect(fs.existsSync(TEMPLATE_DIR)).toBe(true);

    const directivesDir = path.join(TEMPLATE_DIR, 'directives');
    const executionDir = path.join(TEMPLATE_DIR, 'execution');
    expect(fs.existsSync(directivesDir)).toBe(true);
    expect(fs.existsSync(executionDir)).toBe(true);

    const readmePath = path.join(directivesDir, 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);

    const manifestPath = path.join(executionDir, 'tool_manifest.json');
    validateToolManifest(manifestPath, executionDir);
  });

  it('all tenant UUID folders have directives and valid tool manifests', () => {
    expect(fs.existsSync(TENANTS_DIR)).toBe(true);

    const entries = fs.readdirSync(TENANTS_DIR, { withFileTypes: true });
    const tenantDirs = entries
      .filter((entry) => entry.isDirectory() && UUID_REGEX.test(entry.name))
      .map((entry) => entry.name);

    for (const tenantId of tenantDirs) {
      const tenantPath = path.join(TENANTS_DIR, tenantId);
      const directivesDir = path.join(tenantPath, 'directives');
      const executionDir = path.join(tenantPath, 'execution');

      expect(fs.existsSync(directivesDir)).toBe(true);
      expect(fs.existsSync(executionDir)).toBe(true);

      const readmePath = path.join(directivesDir, 'README.md');
      expect(fs.existsSync(readmePath)).toBe(true);
      const readmeContent = fs.readFileSync(readmePath, 'utf-8');
      expect(readmeContent.trim().length).toBeGreaterThan(0);

      const manifestPath = path.join(executionDir, 'tool_manifest.json');
      validateToolManifest(manifestPath, executionDir);
    }
  });
});
