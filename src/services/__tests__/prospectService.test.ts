/**
 * ProspectService Tests
 *
 * Tests for prospect file creation, reading, updating, and email lookup cache.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProspectService, CreateProspectInput } from '../prospectService.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ProspectService', () => {
  let service: ProspectService;
  const testProjectRoot = path.join(process.cwd(), 'test-temp-prospects');
  const testTenantId = 'test-tenant';
  const prospectsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'relationships', 'prospects');

  beforeAll(async () => {
    // Create test directory structure
    await fs.promises.mkdir(prospectsFolder, { recursive: true });
  });

  beforeEach(() => {
    service = new ProspectService(testProjectRoot);
  });

  afterEach(async () => {
    // Clean up prospect files after each test
    if (fs.existsSync(prospectsFolder)) {
      const files = await fs.promises.readdir(prospectsFolder);
      for (const file of files) {
        await fs.promises.unlink(path.join(prospectsFolder, file));
      }
    }
  });

  afterAll(async () => {
    // Remove test directory
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('createProspect', () => {
    it('creates prospect file with proper slug generation (kebab-case)', async () => {
      const input: CreateProspectInput = {
        name: 'John Smith',
        email: 'john@example.com',
        company: 'ABC Corp',
        title: 'CEO',
      };

      const prospect = await service.createProspect(testTenantId, input);

      expect(prospect.slug).toBe('john-smith');
      expect(prospect.frontmatter.name).toBe('John Smith');
      expect(prospect.frontmatter.email).toBe('john@example.com');
      expect(prospect.frontmatter.stage).toBe('identified');

      // Verify file exists
      const filePath = path.join(prospectsFolder, 'john-smith.md');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('handles special characters in name for slug generation', async () => {
      const input: CreateProspectInput = {
        name: "John O'Brien Jr.",
        email: 'john.obrien@example.com',
      };

      const prospect = await service.createProspect(testTenantId, input);

      expect(prospect.slug).toBe('john-obrien-jr');
    });

    it('generates unique slug for duplicate names', async () => {
      const input1: CreateProspectInput = {
        name: 'Jane Doe',
        email: 'jane1@example.com',
      };
      const input2: CreateProspectInput = {
        name: 'Jane Doe',
        email: 'jane2@example.com',
      };

      const prospect1 = await service.createProspect(testTenantId, input1);
      const prospect2 = await service.createProspect(testTenantId, input2);

      expect(prospect1.slug).toBe('jane-doe');
      expect(prospect2.slug).toBe('jane-doe-1');
    });

    it('validates required fields (name, email)', async () => {
      await expect(service.createProspect(testTenantId, { name: '', email: 'test@test.com' }))
        .rejects.toThrow('Prospect name is required');

      await expect(service.createProspect(testTenantId, { name: 'Test', email: '' }))
        .rejects.toThrow('Prospect email is required');
    });
  });

  describe('frontmatter parsing and serialization', () => {
    it('parses JSON frontmatter correctly', async () => {
      const input: CreateProspectInput = {
        name: 'Test Person',
        email: 'test@test.com',
        company: 'Test Co',
        title: 'Manager',
        phone: '555-1234',
        website: 'test.com',
        linkedin: 'linkedin.com/in/testperson',
        source: 'google_maps',
        source_query: 'managers in Salt Lake City',
        stage: 'researched',
      };

      const created = await service.createProspect(testTenantId, input);
      const read = await service.readProspect(testTenantId, created.slug);

      expect(read).not.toBeNull();
      expect(read!.frontmatter.name).toBe('Test Person');
      expect(read!.frontmatter.email).toBe('test@test.com');
      expect(read!.frontmatter.company).toBe('Test Co');
      expect(read!.frontmatter.title).toBe('Manager');
      expect(read!.frontmatter.phone).toBe('555-1234');
      expect(read!.frontmatter.website).toBe('test.com');
      expect(read!.frontmatter.linkedin).toBe('linkedin.com/in/testperson');
      expect(read!.frontmatter.source).toBe('google_maps');
      expect(read!.frontmatter.source_query).toBe('managers in Salt Lake City');
      expect(read!.frontmatter.stage).toBe('researched');
      expect(read!.frontmatter.created_at).toBeDefined();
      expect(read!.frontmatter.updated_at).toBeDefined();
    });
  });

  describe('readProspect', () => {
    it('returns null for non-existent prospect', async () => {
      const result = await service.readProspect(testTenantId, 'non-existent');
      expect(result).toBeNull();
    });

    it('reads prospect by slug correctly', async () => {
      const input: CreateProspectInput = {
        name: 'Read Test',
        email: 'read@test.com',
        businessContext: 'Some business context',
        researchNotes: 'Some research notes',
      };

      const created = await service.createProspect(testTenantId, input);
      const read = await service.readProspect(testTenantId, created.slug);

      expect(read).not.toBeNull();
      expect(read!.slug).toBe('read-test');
      expect(read!.frontmatter.name).toBe('Read Test');
      expect(read!.businessContext).toBe('Some business context');
      expect(read!.researchNotes).toBe('Some research notes');
    });
  });

  describe('updateProspect', () => {
    it('preserves markdown body and interaction history when updating', async () => {
      const input: CreateProspectInput = {
        name: 'Update Test',
        email: 'update@test.com',
        businessContext: 'Original context',
        personalizationHooks: 'Original hooks',
      };

      const created = await service.createProspect(testTenantId, input);

      // Add interaction history
      await service.updateProspect(testTenantId, created.slug, {
        interactionHistoryAppend: '### 2026-01-07 - Initial contact\nSent first email.',
      });

      // Update other fields - interaction history should be preserved
      const updated = await service.updateProspect(testTenantId, created.slug, {
        stage: 'contacted',
        businessContext: 'Updated context',
      });

      expect(updated.frontmatter.stage).toBe('contacted');
      expect(updated.businessContext).toBe('Updated context');
      expect(updated.personalizationHooks).toBe('Original hooks');
      expect(updated.interactionHistory).toContain('Initial contact');
      expect(updated.interactionHistory).toContain('Sent first email.');
    });

    it('appends to interaction history without overwriting', async () => {
      const input: CreateProspectInput = {
        name: 'History Test',
        email: 'history@test.com',
      };

      const created = await service.createProspect(testTenantId, input);

      await service.updateProspect(testTenantId, created.slug, {
        interactionHistoryAppend: '### Entry 1\nFirst entry.',
      });

      const afterSecondUpdate = await service.updateProspect(testTenantId, created.slug, {
        interactionHistoryAppend: '### Entry 2\nSecond entry.',
      });

      expect(afterSecondUpdate.interactionHistory).toContain('Entry 1');
      expect(afterSecondUpdate.interactionHistory).toContain('First entry.');
      expect(afterSecondUpdate.interactionHistory).toContain('Entry 2');
      expect(afterSecondUpdate.interactionHistory).toContain('Second entry.');
    });
  });

  describe('listProspects with email lookup', () => {
    it('lists all prospects with frontmatter', async () => {
      await service.createProspect(testTenantId, { name: 'Person One', email: 'one@test.com' });
      await service.createProspect(testTenantId, { name: 'Person Two', email: 'two@test.com' });
      await service.createProspect(testTenantId, { name: 'Person Three', email: 'three@test.com' });

      const prospects = await service.listProspects(testTenantId);

      expect(prospects.length).toBe(3);
      const emails = prospects.map(p => p.frontmatter.email).sort();
      expect(emails).toEqual(['one@test.com', 'three@test.com', 'two@test.com']);
    });

    it('findProspectByEmail returns correct prospect (O(1) after cache init)', async () => {
      await service.createProspect(testTenantId, { name: 'Lookup Test', email: 'lookup@test.com' });
      await service.createProspect(testTenantId, { name: 'Other Person', email: 'other@test.com' });

      // Initialize cache
      await service.initializeCache(testTenantId);

      const startTime = Date.now();
      const found = await service.findProspectByEmail(testTenantId, 'lookup@test.com');
      const lookupTime = Date.now() - startTime;

      expect(found).not.toBeNull();
      expect(found!.frontmatter.name).toBe('Lookup Test');
      expect(lookupTime).toBeLessThan(10); // Should be < 10ms for cached lookup
    });

    it('findProspectByEmail is case-insensitive', async () => {
      await service.createProspect(testTenantId, { name: 'Case Test', email: 'CaseTest@Example.COM' });

      const found = await service.findProspectByEmail(testTenantId, 'casetest@example.com');

      expect(found).not.toBeNull();
      expect(found!.frontmatter.name).toBe('Case Test');
    });

    it('findProspectByEmail returns null for non-existent email', async () => {
      await service.createProspect(testTenantId, { name: 'Existing', email: 'existing@test.com' });

      const found = await service.findProspectByEmail(testTenantId, 'nonexistent@test.com');

      expect(found).toBeNull();
    });
  });
});
