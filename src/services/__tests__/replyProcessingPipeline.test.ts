/**
 * Reply Processing Pipeline Tests
 *
 * Tests for the enhanced reply processing that integrates with the prospect system,
 * queues responses for approval, and handles meeting booking flow.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ProspectService, CreateProspectInput } from '../prospectService.js';
import { ReplyProcessingService, Reply, ReplyAnalysis } from '../replyProcessingService.js';
import { CampaignService } from '../campaignService.js';
import { UnsubscribeService } from '../unsubscribeService.js';
import { TimelineService } from '../timelineService.js';
import { ApprovalQueueService } from '../approvalQueueService.js';
import { ApprovalNotificationService } from '../approvalNotificationService.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock TelegramService to avoid network calls
jest.mock('../messaging/telegram.js', () => ({
  TelegramService: jest.fn().mockImplementation(() => ({
    sendTextMessage: jest.fn().mockResolvedValue('mock-message-id'),
  })),
}));

describe('Reply Processing Pipeline', () => {
  const testProjectRoot = path.join(process.cwd(), 'test-temp-reply-pipeline');
  const testTenantId = 'test-tenant-reply';
  const prospectsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'relationships', 'prospects');
  const campaignsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'operations', 'campaigns');
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');

  let prospectService: ProspectService;
  let campaignService: CampaignService;
  let unsubscribeService: UnsubscribeService;
  let timelineService: TimelineService;
  let approvalQueueService: ApprovalQueueService;
  let replyProcessingService: ReplyProcessingService;

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

    replyProcessingService = new ReplyProcessingService(
      campaignService,
      unsubscribeService,
      timelineService,
      testProjectRoot
    );

    // Set the prospect service on reply processor
    replyProcessingService.setProspectService(prospectService);
    replyProcessingService.setApprovalQueueService(approvalQueueService);
  });

  afterEach(async () => {
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

  describe('Email matching via prospect lookup cache', () => {
    it('matches email to prospect via ProspectService lookup cache', async () => {
      // Create a prospect
      const prospectInput: CreateProspectInput = {
        name: 'Jane Smith',
        email: 'jane@testcompany.com',
        company: 'Test Company',
        title: 'Director',
      };
      const prospect = await prospectService.createProspect(testTenantId, prospectInput);

      // Initialize cache
      await prospectService.initializeCache(testTenantId);

      // Match email to prospect
      const match = await replyProcessingService.matchEmailToProspect(testTenantId, 'jane@testcompany.com');

      expect(match).not.toBeNull();
      expect(match!.slug).toBe(prospect.slug);
      expect(match!.frontmatter.name).toBe('Jane Smith');
    });

    it('returns null for non-prospect email', async () => {
      // Create a prospect with different email
      await prospectService.createProspect(testTenantId, {
        name: 'Other Person',
        email: 'other@example.com',
      });

      // Try to match non-existent email
      const match = await replyProcessingService.matchEmailToProspect(testTenantId, 'unknown@example.com');

      expect(match).toBeNull();
    });
  });

  describe('Intent detection and stage updates', () => {
    it('updates prospect stage to "replied" on interested intent', async () => {
      // Create prospect in "contacted" stage
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Interested Prospect',
        email: 'interested@test.com',
        stage: 'contacted',
      });

      // Create reply with interested intent
      const reply: Reply = {
        email_id: 'test-reply-1',
        from_email: 'interested@test.com',
        subject: 'Re: Your message',
        body: "This sounds interesting! I'd love to learn more about what you offer.",
        received_at: new Date().toISOString(),
      };

      // Process reply
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check prospect was updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('replied');
    });

    it('updates prospect stage to "qualified" on meeting_request intent', async () => {
      // Create prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Meeting Prospect',
        email: 'meeting@test.com',
        stage: 'contacted',
      });

      // Create reply with meeting request
      const reply: Reply = {
        email_id: 'test-reply-2',
        from_email: 'meeting@test.com',
        subject: 'Re: Your message',
        body: "Yes, I'd like to schedule a call. Are you available next week?",
        received_at: new Date().toISOString(),
      };

      // Process reply
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check prospect was updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('qualified');
    });

    it('updates prospect stage to "lost" on not_interested intent', async () => {
      // Create prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Not Interested Prospect',
        email: 'notinterested@test.com',
        stage: 'contacted',
      });

      // Create reply with not interested intent
      const reply: Reply = {
        email_id: 'test-reply-3',
        from_email: 'notinterested@test.com',
        subject: 'Re: Your message',
        body: "Thank you but I'm not interested at this time.",
        received_at: new Date().toISOString(),
      };

      // Process reply
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check prospect was updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('lost');
    });

    it('does not change stage on out_of_office intent', async () => {
      // Create prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'OOO Prospect',
        email: 'ooo@test.com',
        stage: 'contacted',
      });

      // Create out of office reply
      const reply: Reply = {
        email_id: 'test-reply-4',
        from_email: 'ooo@test.com',
        subject: 'Out of Office',
        body: "I'm currently out of office and will return on Monday.",
        received_at: new Date().toISOString(),
      };

      // Process reply
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check prospect stage unchanged
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('contacted');
    });
  });

  describe('Response drafting and approval queue', () => {
    it('queues response draft for approval (not auto-sent)', async () => {
      // Create prospect with context
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Queue Test Prospect',
        email: 'queue@test.com',
        company: 'Queue Corp',
        stage: 'contacted',
        businessContext: 'They run a software company focused on B2B SaaS.',
        researchNotes: 'Recently raised Series A, looking to scale sales team.',
      });

      // Create a campaign for this prospect
      await campaignService.createCampaign(testTenantId, 'test-campaign', '+1234567890', 'Test goal');
      await campaignService.activateCampaign(testTenantId, 'test-campaign');
      await campaignService.addTargetByProspectSlug(testTenantId, 'test-campaign', prospect.slug);

      // Create interested reply
      const reply: Reply = {
        email_id: 'test-reply-5',
        from_email: 'queue@test.com',
        subject: 'Re: Your message',
        body: "Tell me more about how this works.",
        received_at: new Date().toISOString(),
      };

      // Process reply (this should draft a response and queue it)
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check that a response was queued
      const pendingActions = await approvalQueueService.listPendingActions(testTenantId);

      // Should have at least one pending action for the response
      const responseAction = pendingActions.find(a =>
        a.target_email === 'queue@test.com' &&
        a.action_type === 'send_email'
      );

      expect(responseAction).toBeDefined();
      expect(responseAction!.status).toBe('pending');
      // Body should contain some response content
      expect(responseAction!.body.length).toBeGreaterThan(0);
    });
  });

  describe('Interaction history tracking', () => {
    it('appends interaction to prospect file history', async () => {
      // Create prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'History Prospect',
        email: 'history@test.com',
        stage: 'contacted',
      });

      // Create reply
      const reply: Reply = {
        email_id: 'test-reply-6',
        from_email: 'history@test.com',
        subject: 'Re: Quick question',
        body: "Thanks for reaching out. I have a few questions.",
        received_at: '2026-01-07T10:30:00.000Z',
      };

      // Process reply
      await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check interaction history was updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);

      expect(updatedProspect!.interactionHistory).toContain('Reply received');
      expect(updatedProspect!.interactionHistory).toContain('history@test.com');
    });
  });

  describe('Meeting booking flow', () => {
    it('flags meeting request for calendar availability lookup', async () => {
      // Create prospect
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Meeting Request Prospect',
        email: 'booking@test.com',
        stage: 'contacted',
      });

      // Create a campaign
      await campaignService.createCampaign(testTenantId, 'booking-campaign', '+1234567890', 'Booking test');
      await campaignService.activateCampaign(testTenantId, 'booking-campaign');
      await campaignService.addTargetByProspectSlug(testTenantId, 'booking-campaign', prospect.slug);

      // Create meeting request reply
      const reply: Reply = {
        email_id: 'test-reply-7',
        from_email: 'booking@test.com',
        subject: 'Re: Your message',
        body: "I'd love to set up a time to chat. Can we schedule a 30 minute call this week?",
        received_at: new Date().toISOString(),
      };

      // Process reply
      const result = await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Check result indicates meeting request was detected
      expect(result.analysis?.intent).toBe('meeting_request');
      expect(result.meetingRequested).toBe(true);

      // Prospect should be qualified
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('qualified');
    });
  });
});
