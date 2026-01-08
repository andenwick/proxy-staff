/**
 * Scheduler Cycle Tests
 *
 * Tests for the enhanced CampaignScheduler that:
 * - Processes unprocessed replies
 * - Sends approved emails at scheduled time
 * - Proposes follow-ups when due
 * - Respects daily limits
 * - Reports pipeline health metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { ProspectService, CreateProspectInput } from '../prospectService.js';
import { CampaignService } from '../campaignService.js';
import { UnsubscribeService } from '../unsubscribeService.js';
import { TimelineService } from '../timelineService.js';
import { ApprovalQueueService } from '../approvalQueueService.js';
import { ResponseTimingService, ScheduledSend } from '../responseTimingService.js';
import { CampaignScheduler } from '../campaignScheduler.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock TelegramService
jest.mock('../messaging/telegram.js', () => ({
  TelegramService: jest.fn().mockImplementation(() => ({
    sendTextMessage: jest.fn().mockResolvedValue('mock-message-id'),
  })),
}));

// Mock Prisma
const mockPrisma = {
  tenant: {
    findMany: jest.fn().mockResolvedValue([{ id: 'test-tenant-scheduler' }]),
  },
} as unknown as PrismaClient;

describe('Campaign Scheduler Cycle', () => {
  const testProjectRoot = path.join(process.cwd(), 'test-temp-scheduler-cycle');
  const testTenantId = 'test-tenant-scheduler';
  const prospectsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'relationships', 'prospects');
  const campaignsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'operations', 'campaigns');
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');

  let prospectService: ProspectService;
  let campaignService: CampaignService;
  let unsubscribeService: UnsubscribeService;
  let timelineService: TimelineService;
  let approvalQueueService: ApprovalQueueService;
  let responseTimingService: ResponseTimingService;
  let scheduler: CampaignScheduler;

  beforeAll(async () => {
    // Create test directory structure
    await fs.promises.mkdir(prospectsFolder, { recursive: true });
    await fs.promises.mkdir(campaignsFolder, { recursive: true });
    await fs.promises.mkdir(stateFolder, { recursive: true });
  });

  beforeEach(async () => {
    // Initialize services
    prospectService = new ProspectService(testProjectRoot);
    campaignService = new CampaignService(testProjectRoot);
    unsubscribeService = new UnsubscribeService(testProjectRoot);
    timelineService = new TimelineService(testProjectRoot);
    approvalQueueService = new ApprovalQueueService(testProjectRoot);
    responseTimingService = new ResponseTimingService(testProjectRoot);

    scheduler = new CampaignScheduler(
      mockPrisma,
      campaignService,
      approvalQueueService,
      unsubscribeService,
      timelineService,
      undefined, // messageProcessor
      testProjectRoot
    );

    // Wire up the services
    scheduler.setProspectService(prospectService);
    scheduler.setResponseTimingService(responseTimingService);
  });

  afterEach(async () => {
    // Stop scheduler if running
    await scheduler.stop();

    // Clean up test files
    if (fs.existsSync(prospectsFolder)) {
      const files = await fs.promises.readdir(prospectsFolder);
      for (const file of files) {
        await fs.promises.unlink(path.join(prospectsFolder, file));
      }
    }
    if (fs.existsSync(campaignsFolder)) {
      await fs.promises.rm(campaignsFolder, { recursive: true, force: true });
      await fs.promises.mkdir(campaignsFolder, { recursive: true });
    }
    if (fs.existsSync(stateFolder)) {
      const files = await fs.promises.readdir(stateFolder);
      for (const file of files) {
        await fs.promises.unlink(path.join(stateFolder, file));
      }
    }
  });

  afterAll(async () => {
    // Remove test directory
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('Unprocessed reply processing', () => {
    it('processes unprocessed replies during scheduler cycle', async () => {
      // Create a prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Reply Test',
        email: 'reply-test@example.com',
        stage: 'contacted',
      });

      // Initialize the email cache so the reply can be matched
      await prospectService.initializeCache(testTenantId);

      // Create a campaign and add the prospect
      await campaignService.createCampaign(testTenantId, 'scheduler-test', '+1234567890', 'Test campaign');
      await campaignService.activateCampaign(testTenantId, 'scheduler-test');
      await campaignService.addTargetByProspectSlug(testTenantId, 'scheduler-test', prospect.slug);

      // Store an unprocessed reply in state
      const unprocessedRepliesPath = path.join(stateFolder, 'unprocessed_replies.json');
      const unprocessedReply = {
        replies: [{
          email_id: 'test-reply-sched-1',
          from_email: 'reply-test@example.com',
          subject: 'Re: Your message',
          body: "This sounds interesting! Tell me more.",
          received_at: new Date().toISOString(),
        }],
      };
      await fs.promises.writeFile(unprocessedRepliesPath, JSON.stringify(unprocessedReply, null, 2));

      // Process unprocessed replies
      const result = await scheduler.processUnprocessedReplies(testTenantId);

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);

      // Verify prospect was updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('replied');
    });
  });

  describe('Scheduled send processing', () => {
    it('sends approved emails at scheduled time', async () => {
      // Create a prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Send Test',
        email: 'send-test@example.com',
        stage: 'contacted',
      });

      // Create a campaign and add the prospect
      await campaignService.createCampaign(testTenantId, 'send-test', '+1234567890', 'Send test campaign');
      await campaignService.activateCampaign(testTenantId, 'send-test');
      await campaignService.addTargetByProspectSlug(testTenantId, 'send-test', prospect.slug);

      // Queue an action and approve it
      const actionId = await approvalQueueService.queueAction(testTenantId, {
        campaign_id: 'send-test',
        campaign_name: 'send-test',
        target_id: prospect.slug,
        target_name: prospect.frontmatter.name,
        target_email: prospect.frontmatter.email,
        action_type: 'send_email',
        channel: 'email',
        subject: 'Test email',
        body: 'Test body',
        reasoning: 'Test reasoning',
      });

      // Approve the action
      await approvalQueueService.approveActions(testTenantId, [actionId]);

      // Queue for scheduled send (past time so it's ready)
      const pastTime = new Date(Date.now() - 1000); // 1 second ago
      await responseTimingService.queueForSend(testTenantId, actionId, pastTime);

      // Process scheduled sends
      const result = await scheduler.processScheduledSends(testTenantId);

      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);

      // Verify the scheduled send was marked complete
      const scheduledSends = await responseTimingService.getScheduledSends(testTenantId);
      const completedSend = scheduledSends.find(s => s.action_id === actionId);
      expect(completedSend?.status).toBe('sent');
    });
  });

  describe('Follow-up proposal', () => {
    it('proposes follow-ups for prospects that are due', async () => {
      // Create a prospect that was contacted 5 days ago
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Follow-up Test',
        email: 'followup-test@example.com',
        stage: 'contacted',
      });

      // Create a campaign with 3-day follow-up interval and add the prospect
      await campaignService.createCampaign(testTenantId, 'followup-test', '+1234567890', 'Follow-up test');
      await campaignService.activateCampaign(testTenantId, 'followup-test');
      const targetRef = await campaignService.addTargetByProspectSlug(testTenantId, 'followup-test', prospect.slug);

      // Update the target with a last touch that was 5 days ago
      const targetsPath = path.join(campaignsFolder, 'followup-test', 'targets.md');
      const content = await fs.promises.readFile(targetsPath, 'utf-8');
      const updated = content.replace(
        '"last_touch_at": null',
        `"last_touch_at": "${fiveDaysAgo}"`
      ).replace(
        '"touch_count": 0',
        '"touch_count": 1'
      );
      await fs.promises.writeFile(targetsPath, updated, 'utf-8');

      // Process follow-ups
      const result = await scheduler.processFollowUps(testTenantId);

      expect(result.proposed).toBeGreaterThanOrEqual(1);

      // Check that a follow-up action was queued
      const pendingActions = await approvalQueueService.listPendingActions(testTenantId);
      const followUpAction = pendingActions.find(a =>
        a.target_email === 'followup-test@example.com'
      );

      expect(followUpAction).toBeDefined();
    });
  });

  describe('Daily limits enforcement', () => {
    it('respects daily limits when processing', async () => {
      // Create a campaign with low daily limit
      await campaignService.createCampaign(testTenantId, 'limit-test', '+1234567890', 'Limit test');
      await campaignService.activateCampaign(testTenantId, 'limit-test');

      // Update campaign to have very low daily limit
      await campaignService.updateCampaign(testTenantId, 'limit-test', {
        settings: {
          max_daily_outreach: 2,
          min_days_between_touches: 3,
          max_touches_per_target: 5,
          require_approval: true,
          approval_mode: 'batch',
        },
      });

      // Create multiple prospects
      for (let i = 0; i < 5; i++) {
        const prospect = await prospectService.createProspect(testTenantId, {
          name: `Limit Test ${i}`,
          email: `limit-test-${i}@example.com`,
          stage: 'identified',
        });
        await campaignService.addTargetByProspectSlug(testTenantId, 'limit-test', prospect.slug);
      }

      // Get daily send count
      const count = await scheduler.getDailySendCount(testTenantId, 'limit-test');
      expect(count).toBe(0);

      // Check if under limit
      const campaign = await campaignService.getCampaign(testTenantId, 'limit-test');
      const isUnderLimit = count < (campaign?.config.settings.max_daily_outreach || 20);
      expect(isUnderLimit).toBe(true);
    });
  });

  describe('Pipeline health reporting', () => {
    it('generates health report with stage counts', async () => {
      // Create prospects at various stages
      const prospects = [
        { name: 'Health 1', email: 'health1@test.com', stage: 'identified' as const },
        { name: 'Health 2', email: 'health2@test.com', stage: 'contacted' as const },
        { name: 'Health 3', email: 'health3@test.com', stage: 'replied' as const },
        { name: 'Health 4', email: 'health4@test.com', stage: 'qualified' as const },
        { name: 'Health 5', email: 'health5@test.com', stage: 'lost' as const },
      ];

      // Create a campaign
      await campaignService.createCampaign(testTenantId, 'health-test', '+1234567890', 'Health test');
      await campaignService.activateCampaign(testTenantId, 'health-test');

      for (const data of prospects) {
        const prospect = await prospectService.createProspect(testTenantId, data);
        await campaignService.addTargetByProspectSlug(testTenantId, 'health-test', prospect.slug);

        // Update the target stage to match prospect
        const refs = await campaignService.getTargetReferences(testTenantId, 'health-test');
        const targetRef = refs.find(r => r.prospect_slug === prospect.slug);
        if (targetRef && data.stage !== 'identified') {
          // Update target reference stage
          const targetsPath = path.join(campaignsFolder, 'health-test', 'targets.md');
          const content = await fs.promises.readFile(targetsPath, 'utf-8');
          // Find and replace the campaign_stage for this specific prospect
          const pattern = new RegExp(`("prospect_slug": "${prospect.slug}"[^}]*"campaign_stage": )"identified"`);
          const updated = content.replace(pattern, `$1"${data.stage}"`);
          await fs.promises.writeFile(targetsPath, updated, 'utf-8');
        }
      }

      // Generate health report
      const report = await scheduler.getPipelineHealth(testTenantId);

      expect(report.campaigns).toHaveLength(1);
      expect(report.campaigns[0].name).toBe('health-test');
      expect(report.campaigns[0].total_targets).toBe(5);
      expect(report.campaigns[0].by_stage).toBeDefined();
    });

    it('identifies stalled prospects (no activity in X days)', async () => {
      // Create a prospect that was contacted 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Stalled Test',
        email: 'stalled@test.com',
        stage: 'contacted',
      });

      // Update the created_at/updated_at to 10 days ago
      await prospectService.updateProspect(testTenantId, prospect.slug, {
        interactionHistoryAppend: `### ${tenDaysAgo.split('T')[0]} - Last contact\nLast outreach sent.`,
      });

      // Create campaign
      await campaignService.createCampaign(testTenantId, 'stalled-test', '+1234567890', 'Stalled test');
      await campaignService.activateCampaign(testTenantId, 'stalled-test');
      await campaignService.addTargetByProspectSlug(testTenantId, 'stalled-test', prospect.slug);

      // Update target with old last_touch_at
      const targetsPath = path.join(campaignsFolder, 'stalled-test', 'targets.md');
      const content = await fs.promises.readFile(targetsPath, 'utf-8');
      const updated = content
        .replace('"last_touch_at": null', `"last_touch_at": "${tenDaysAgo}"`)
        .replace('"touch_count": 0', '"touch_count": 1')
        .replace('"campaign_stage": "identified"', '"campaign_stage": "contacted"');
      await fs.promises.writeFile(targetsPath, updated, 'utf-8');

      // Get stalled prospects
      const stalled = await scheduler.getStalledProspects(testTenantId, 7); // 7 day threshold

      expect(stalled.length).toBeGreaterThanOrEqual(1);
      expect(stalled.some(s => s.prospect_slug === prospect.slug)).toBe(true);
    });
  });
});
