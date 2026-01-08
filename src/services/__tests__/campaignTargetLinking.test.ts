/**
 * Campaign-Prospect Linking Tests
 *
 * Tests for the target reference system that links campaigns to prospects.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CampaignService } from '../campaignService.js';
import { ProspectService } from '../prospectService.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Campaign-Prospect Linking', () => {
  let campaignService: CampaignService;
  let prospectService: ProspectService;
  const testProjectRoot = path.join(process.cwd(), 'test-temp-linking');
  const testTenantId = 'test-tenant';
  const tenantsFolder = path.join(testProjectRoot, 'tenants', testTenantId);
  const campaignsFolder = path.join(tenantsFolder, 'operations', 'campaigns');
  const prospectsFolder = path.join(tenantsFolder, 'relationships', 'prospects');
  const testCampaignName = 'test-campaign';

  beforeAll(async () => {
    // Create test directory structure
    await fs.promises.mkdir(campaignsFolder, { recursive: true });
    await fs.promises.mkdir(prospectsFolder, { recursive: true });
  });

  beforeEach(async () => {
    campaignService = new CampaignService(testProjectRoot);
    prospectService = new ProspectService(testProjectRoot);

    // Create a test campaign
    await campaignService.createCampaign(
      testTenantId,
      testCampaignName,
      '1234567890',
      'Test campaign for linking'
    );
  });

  afterEach(async () => {
    // Clean up campaign files
    const campaignFolder = path.join(campaignsFolder, testCampaignName);
    if (fs.existsSync(campaignFolder)) {
      await fs.promises.rm(campaignFolder, { recursive: true });
    }

    // Clean up prospect files
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

  describe('addTargetByProspectSlug', () => {
    it('stores prospect slug in targets.md (not inline data)', async () => {
      // First create a prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'John Smith',
        email: 'john@example.com',
        company: 'ABC Corp',
      });

      // Add target using prospect slug
      const target = await campaignService.addTargetByProspectSlug(
        testTenantId,
        testCampaignName,
        prospect.slug
      );

      expect(target.prospect_slug).toBe('john-smith');
      expect(target.id).toBeDefined();
      // Target should NOT have inline contact data - only reference
      expect(target.name).toBeUndefined();
      expect(target.email).toBeUndefined();
    });

    it('creates target link with campaign-specific metadata', async () => {
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Jane Doe',
        email: 'jane@example.com',
      });

      const target = await campaignService.addTargetByProspectSlug(
        testTenantId,
        testCampaignName,
        prospect.slug
      );

      expect(target.added_at).toBeDefined();
      expect(target.last_touch_at).toBeNull();
      expect(target.touch_count).toBe(0);
      expect(target.campaign_stage).toBe('identified');
    });
  });

  describe('getTargetWithContext', () => {
    it('loads both campaign config AND prospect file for full context', async () => {
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Context Test',
        email: 'context@test.com',
        company: 'Context Co',
        title: 'Manager',
        businessContext: 'Some business info',
        researchNotes: 'Did some research',
      });

      const target = await campaignService.addTargetByProspectSlug(
        testTenantId,
        testCampaignName,
        prospect.slug
      );

      const fullContext = await campaignService.getTargetWithContext(
        testTenantId,
        testCampaignName,
        target.id
      );

      // Should have target reference data
      expect(fullContext.target.prospect_slug).toBe('context-test');
      expect(fullContext.target.campaign_stage).toBe('identified');

      // Should have full prospect context
      expect(fullContext.prospect).not.toBeNull();
      expect(fullContext.prospect!.frontmatter.name).toBe('Context Test');
      expect(fullContext.prospect!.frontmatter.email).toBe('context@test.com');
      expect(fullContext.prospect!.frontmatter.company).toBe('Context Co');
      expect(fullContext.prospect!.businessContext).toBe('Some business info');
      expect(fullContext.prospect!.researchNotes).toBe('Did some research');
    });
  });

  describe('updateTargetStageWithSync', () => {
    it('updates target stage and syncs to prospect file', async () => {
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Stage Sync Test',
        email: 'sync@test.com',
        stage: 'identified',
      });

      const target = await campaignService.addTargetByProspectSlug(
        testTenantId,
        testCampaignName,
        prospect.slug
      );

      // Update stage
      await campaignService.updateTargetStageWithSync(
        testTenantId,
        testCampaignName,
        target.id,
        'contacted',
        prospectService
      );

      // Verify target stage updated
      const targets = await campaignService.getTargetReferences(testTenantId, testCampaignName);
      const updatedTarget = targets.find(t => t.id === target.id);
      expect(updatedTarget?.campaign_stage).toBe('contacted');

      // Verify prospect stage synced
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect?.frontmatter.stage).toBe('contacted');
    });
  });

  describe('removeTarget', () => {
    it('removes target reference but preserves prospect file', async () => {
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Remove Test',
        email: 'remove@test.com',
      });

      const target = await campaignService.addTargetByProspectSlug(
        testTenantId,
        testCampaignName,
        prospect.slug
      );

      // Remove the target from campaign
      await campaignService.removeTarget(testTenantId, testCampaignName, target.id);

      // Target should be gone from campaign
      const targets = await campaignService.getTargetReferences(testTenantId, testCampaignName);
      expect(targets.find(t => t.id === target.id)).toBeUndefined();

      // Prospect file should still exist
      const prospectStillExists = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(prospectStillExists).not.toBeNull();
      expect(prospectStillExists!.frontmatter.name).toBe('Remove Test');
    });
  });

  describe('backward compatibility', () => {
    it('reads old format targets with inline data (legacy support)', async () => {
      // Manually create a targets.md file with old inline format
      const campaignFolder = path.join(campaignsFolder, testCampaignName);
      const targetsPath = path.join(campaignFolder, 'targets.md');

      const oldFormatContent = `---json
{
  "version": 1,
  "lastUpdated": "2026-01-07T00:00:00.000Z",
  "targets": [
    {
      "id": "legacy-target-id",
      "stage": "contacted",
      "name": "Legacy Person",
      "email": "legacy@test.com",
      "company": "Legacy Corp",
      "touches": [],
      "unsubscribed": false,
      "created_at": "2026-01-01T00:00:00.000Z",
      "stage_changed_at": "2026-01-05T00:00:00.000Z"
    }
  ]
}
---
# Campaign Targets
`;

      await fs.promises.writeFile(targetsPath, oldFormatContent, 'utf-8');

      // Should be able to read old format
      const targets = await campaignService.getTargets(testTenantId, testCampaignName);
      expect(targets).not.toBeNull();
      expect(targets!.targets.length).toBe(1);
      expect(targets!.targets[0].name).toBe('Legacy Person');
      expect(targets!.targets[0].email).toBe('legacy@test.com');
    });
  });
});
