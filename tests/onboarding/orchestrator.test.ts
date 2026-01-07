import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { OnboardingOrchestrator } from '../../src/onboarding/orchestrator';
import { OnboardingResponse } from '../../src/onboarding/types';

describe('OnboardingOrchestrator', () => {
  let orchestrator: OnboardingOrchestrator;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test tenants
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onboard-test-'));
    orchestrator = new OnboardingOrchestrator(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createTenant', () => {
    it('creates v2 folder structure', async () => {
      const tenantPath = await orchestrator.createTenant('test-tenant');

      // Check main folders exist
      const folders = [
        'identity',
        'knowledge',
        'relationships',
        'operations',
        'execution',
        'data',
        'timeline',
      ];

      for (const folder of folders) {
        const stat = await fs.stat(path.join(tenantPath, folder));
        expect(stat.isDirectory()).toBe(true);
      }

      // Check tool manifest exists
      const manifest = await fs.readFile(
        path.join(tenantPath, 'execution', 'tool_manifest.json'),
        'utf-8'
      );
      expect(JSON.parse(manifest)).toEqual({ tools: [] });

      // Check .env exists
      const envContent = await fs.readFile(path.join(tenantPath, '.env'), 'utf-8');
      expect(envContent).toContain('# Tenant credentials');
    });

    it('throws error if tenant already exists', async () => {
      await orchestrator.createTenant('existing-tenant');

      await expect(orchestrator.createTenant('existing-tenant')).rejects.toThrow(
        'already exists'
      );
    });
  });

  describe('validateResponse', () => {
    it('validates required fields', () => {
      const result = orchestrator.validateResponse({});

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.field === 'business.name')).toBe(true);
    });

    it('passes with minimal valid data', () => {
      const result = orchestrator.validateResponse({
        business: {
          name: 'Test',
          industry: 'consulting',
          location: { city: 'SLC', state: 'UT' },
          hours: { timezone: 'America/Denver', schedule: '9-5' },
          owner: { name: 'John', role: 'Owner' },
        },
      });

      expect(result.valid).toBe(true);
    });

    it('returns warnings for missing optional data', () => {
      const result = orchestrator.validateResponse({
        business: {
          name: 'Test',
          industry: 'consulting',
          location: { city: 'SLC', state: 'UT' },
          hours: { timezone: 'America/Denver', schedule: '9-5' },
          owner: { name: 'John', role: 'Owner' },
        },
        services: [],
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('services'))).toBe(true);
    });
  });

  describe('generateFiles', () => {
    it('generates all required files', async () => {
      await orchestrator.createTenant('gen-test');

      const responses: OnboardingResponse = {
        tenantId: 'gen-test',
        collectedAt: new Date().toISOString(),
        business: {
          name: 'Test Corp',
          industry: 'consulting',
          location: { city: 'SLC', state: 'UT' },
          hours: { timezone: 'America/Denver', schedule: 'Mon-Fri 9-5' },
          owner: { name: 'John', role: 'CEO' },
        },
        voice: {
          tone: 'friendly',
          style: 'concise',
          personality: ['helpful'],
          avoidWords: [],
          preferWords: [],
        },
        services: [{ name: 'Consulting', description: 'Business advice' }],
        pricing: { model: 'hourly', ranges: '$100-200' },
        faqs: [],
        policies: [],
        workflows: [
          { id: 'lead-handling', name: 'Lead Handling', enabled: true },
        ],
        goals: {
          primaryObjective: 'Respond quickly',
          painPoints: [],
          tasksToAutomate: [],
          successMetrics: [],
        },
      };

      const result = await orchestrator.generateFiles('gen-test', responses);

      expect(result.success).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);

      // Verify key files exist
      const tenantPath = path.join(tempDir, 'gen-test');
      const claudeMd = await fs.readFile(path.join(tenantPath, 'CLAUDE.md'), 'utf-8');
      expect(claudeMd).toContain('Test Corp');

      const profileMd = await fs.readFile(
        path.join(tenantPath, 'identity', 'profile.md'),
        'utf-8'
      );
      expect(profileMd).toContain('Test Corp');
    });
  });

  describe('validateTenant', () => {
    it('validates tenant has required files', async () => {
      await orchestrator.createTenant('validate-test');

      // Before generating files
      const beforeResult = await orchestrator.validateTenant('validate-test');
      expect(beforeResult.valid).toBe(false);
      expect(beforeResult.errors.some((e) => e.message.includes('CLAUDE.md'))).toBe(true);

      // Generate minimal files
      const tenantPath = path.join(tempDir, 'validate-test');
      await fs.writeFile(path.join(tenantPath, 'CLAUDE.md'), '# Test');
      await fs.writeFile(path.join(tenantPath, 'identity', 'profile.md'), '# Profile');
      await fs.writeFile(path.join(tenantPath, 'identity', 'voice.md'), '# Voice');
      await fs.writeFile(path.join(tenantPath, 'knowledge', 'services.md'), '# Services');

      // After generating files
      const afterResult = await orchestrator.validateTenant('validate-test');
      expect(afterResult.valid).toBe(true);
    });
  });
});
