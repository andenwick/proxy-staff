/**
 * Campaign System Integration Tests
 *
 * End-to-end integration tests for critical paths through the campaign system:
 * 1. New prospect to first email sent
 * 2. Reply handling to response sent
 * 3. Meeting booking flow
 * 4. Scheduler cycle with mixed actions
 * 5. Error recovery
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { ProspectService, CreateProspectInput } from '../prospectService.js';
import { CampaignService } from '../campaignService.js';
import { UnsubscribeService } from '../unsubscribeService.js';
import { TimelineService } from '../timelineService.js';
import { ApprovalQueueService } from '../approvalQueueService.js';
import { ResponseTimingService } from '../responseTimingService.js';
import { ApprovalNotificationService } from '../approvalNotificationService.js';
import { ReplyProcessingService, Reply } from '../replyProcessingService.js';
import { CampaignScheduler } from '../campaignScheduler.js';
import { CampaignWizardService } from '../campaignWizardService.js';

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
const mockSendTextMessage = jest.fn().mockResolvedValue('mock-message-id');

jest.mock('../messaging/telegram.js', () => ({
  TelegramService: jest.fn().mockImplementation(() => ({
    sendTextMessage: mockSendTextMessage,
  })),
}));

// Mock Prisma
const mockPrisma = {
  tenant: {
    findMany: jest.fn().mockResolvedValue([{ id: 'integration-test-tenant' }]),
  },
} as unknown as PrismaClient;

describe('Campaign System Integration Tests', () => {
  const testProjectRoot = path.join(process.cwd(), 'test-temp-integration');
  const testTenantId = 'integration-test-tenant';
  const prospectsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'relationships', 'prospects');
  const campaignsFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'operations', 'campaigns');
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');

  let prospectService: ProspectService;
  let campaignService: CampaignService;
  let unsubscribeService: UnsubscribeService;
  let timelineService: TimelineService;
  let approvalQueueService: ApprovalQueueService;
  let responseTimingService: ResponseTimingService;
  let approvalNotificationService: ApprovalNotificationService;
  let replyProcessingService: ReplyProcessingService;
  let scheduler: CampaignScheduler;
  let wizardService: CampaignWizardService;

  beforeAll(async () => {
    // Create test directory structure
    await fs.promises.mkdir(prospectsFolder, { recursive: true });
    await fs.promises.mkdir(campaignsFolder, { recursive: true });
    await fs.promises.mkdir(stateFolder, { recursive: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Initialize all services
    prospectService = new ProspectService(testProjectRoot);
    campaignService = new CampaignService(testProjectRoot);
    unsubscribeService = new UnsubscribeService(testProjectRoot);
    timelineService = new TimelineService(testProjectRoot);
    approvalQueueService = new ApprovalQueueService(testProjectRoot);
    responseTimingService = new ResponseTimingService(testProjectRoot);
    approvalNotificationService = new ApprovalNotificationService(testProjectRoot, {
      botToken: 'test-token',
    });
    wizardService = new CampaignWizardService(testProjectRoot, { botToken: 'test-token' });

    replyProcessingService = new ReplyProcessingService(
      campaignService,
      unsubscribeService,
      timelineService,
      testProjectRoot
    );
    replyProcessingService.setProspectService(prospectService);
    replyProcessingService.setApprovalQueueService(approvalQueueService);

    scheduler = new CampaignScheduler(
      mockPrisma,
      campaignService,
      approvalQueueService,
      unsubscribeService,
      timelineService,
      undefined,
      testProjectRoot
    );
    scheduler.setProspectService(prospectService);
    scheduler.setResponseTimingService(responseTimingService);
  });

  afterEach(async () => {
    // Stop scheduler
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
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('Full pipeline: new prospect to first email sent', () => {
    it('completes end-to-end flow from prospect creation to email send', async () => {
      // Step 1: Create campaign via wizard (or directly for test)
      await campaignService.createCampaign(
        testTenantId,
        'e2e-test-campaign',
        '+18015551234',
        'Book discovery calls with prospects'
      );
      await campaignService.activateCampaign(testTenantId, 'e2e-test-campaign');

      // Step 2: Prospect found
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Sarah Johnson',
        email: 'sarah@testcompany.com',
        company: 'Test Company LLC',
        title: 'VP of Sales',
        source: 'google_maps',
        source_query: 'sales consultants Salt Lake City',
        businessContext: 'Fast-growing B2B SaaS company with 20 employees',
        researchNotes: 'Recently hired 3 new sales reps, likely needs training',
      });

      expect(prospect.slug).toBe('sarah-johnson');
      expect(prospect.frontmatter.stage).toBe('identified');

      // Step 3: Prospect approved and added to campaign
      await campaignService.addTargetByProspectSlug(testTenantId, 'e2e-test-campaign', prospect.slug);

      // Step 4: Send notification about new prospect
      const campaign = await campaignService.getCampaign(testTenantId, 'e2e-test-campaign');
      await approvalNotificationService.notifyNewProspect(
        testTenantId,
        await prospectService.readProspect(testTenantId, prospect.slug) as any,
        campaign!.config,
        '+18015551234'
      );

      expect(mockSendTextMessage).toHaveBeenCalled();
      const notificationMessage = mockSendTextMessage.mock.calls[0][1];
      expect(notificationMessage).toContain('Sarah Johnson');

      // Step 5: Update stage to researched (research completed)
      await prospectService.updateProspect(testTenantId, prospect.slug, {
        stage: 'researched',
        researchNotes: 'Confirmed they are looking for sales automation tools',
      });

      // Step 6: Queue email action for approval
      const actionId = await approvalQueueService.queueAction(testTenantId, {
        campaign_id: campaign!.id,
        campaign_name: 'e2e-test-campaign',
        target_id: prospect.slug,
        target_name: 'Sarah Johnson',
        target_email: 'sarah@testcompany.com',
        action_type: 'send_email',
        channel: 'email',
        subject: 'Quick question about your sales team growth',
        body: 'Hi Sarah,\n\nI noticed Test Company has been growing...',
        reasoning: 'Personalized based on recent hiring',
      });

      expect(actionId).toBeDefined();

      // Step 7: Approve the email
      await approvalQueueService.approveActions(testTenantId, [actionId]);

      const approvedActions = await approvalQueueService.getApprovedActions(testTenantId);
      expect(approvedActions.length).toBe(1);
      expect(approvedActions[0].id).toBe(actionId);

      // Step 8: Calculate scheduled send time and queue
      const sendTime = responseTimingService.calculateSendTime({
        response_delay_min_hours: 1,
        response_delay_max_hours: 4,
        business_hours_only: false,
        business_hours_start: '09:00',
        business_hours_end: '17:00',
        business_hours_timezone: 'America/Denver',
        response_mode: 'delayed',
      });

      await responseTimingService.queueForSend(testTenantId, actionId, sendTime);

      const scheduledSends = await responseTimingService.getScheduledSends(testTenantId);
      expect(scheduledSends.length).toBe(1);
      expect(scheduledSends[0].action_id).toBe(actionId);
      expect(scheduledSends[0].status).toBe('pending');

      // Step 9: Simulate scheduled send becoming ready (set time in past)
      const pastTime = new Date(Date.now() - 1000);
      await responseTimingService.queueForSend(testTenantId, actionId + '-test', pastTime);

      const readyToSend = await responseTimingService.getReadyToSend(testTenantId);
      expect(readyToSend.some(s => s.scheduled_for === pastTime.toISOString())).toBe(true);

      // The full flow is complete - prospect went from identified to ready-to-contact
    });
  });

  describe('Full pipeline: reply handling to response sent', () => {
    it('handles reply from prospect and queues response for approval', async () => {
      // Setup: Create campaign and prospect
      await campaignService.createCampaign(testTenantId, 'reply-test-campaign', '+18015551234', 'Test');
      await campaignService.activateCampaign(testTenantId, 'reply-test-campaign');

      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Mike Wilson',
        email: 'mike@replytest.com',
        company: 'Reply Test Inc',
        stage: 'contacted',
        businessContext: 'Mid-size company looking for efficiency tools',
      });

      await campaignService.addTargetByProspectSlug(testTenantId, 'reply-test-campaign', prospect.slug);
      await prospectService.initializeCache(testTenantId);

      // Step 1: Reply received - clear "interested" pattern without question words
      const reply: Reply = {
        email_id: 'reply-123',
        from_email: 'mike@replytest.com',
        subject: 'Re: Quick question',
        body: "This sounds good! I would love to learn more about your solution.",
        received_at: new Date().toISOString(),
      };

      // Step 2: Process reply
      const result = await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Verify reply was processed (processed=true means it worked)
      expect(result.processed).toBe(true);
      expect(result.analysis?.intent).toBe('interested');

      // Step 3: Verify prospect stage updated
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('replied');

      // Step 4: Verify interaction history updated
      expect(updatedProspect!.interactionHistory).toContain('Reply received');

      // Step 5: Verify response queued for approval
      const pendingActions = await approvalQueueService.listPendingActions(testTenantId);
      const responseAction = pendingActions.find(a => a.target_email === 'mike@replytest.com');

      expect(responseAction).toBeDefined();
      expect(responseAction!.action_type).toBe('send_email');
      expect(responseAction!.body.length).toBeGreaterThan(0);

      // Step 6: Approve response
      await approvalQueueService.approveActions(testTenantId, [responseAction!.id]);

      // Step 7: Schedule with timing
      const sendTime = responseTimingService.calculateSendTime({
        response_delay_min_hours: 1,
        response_delay_max_hours: 2,
        business_hours_only: false,
        business_hours_start: '09:00',
        business_hours_end: '17:00',
        business_hours_timezone: 'America/Denver',
        response_mode: 'delayed',
      });

      await responseTimingService.queueForSend(testTenantId, responseAction!.id, sendTime);

      const scheduled = await responseTimingService.getScheduledSends(testTenantId);
      expect(scheduled.some(s => s.action_id === responseAction!.id)).toBe(true);
    });
  });

  describe('Meeting booking flow', () => {
    it('handles meeting request and updates prospect to qualified', async () => {
      // Setup
      await campaignService.createCampaign(testTenantId, 'meeting-campaign', '+18015551234', 'Book meetings');
      await campaignService.activateCampaign(testTenantId, 'meeting-campaign');

      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Lisa Chen',
        email: 'lisa@meetingtest.com',
        company: 'Meeting Test Corp',
        stage: 'contacted',
      });

      await campaignService.addTargetByProspectSlug(testTenantId, 'meeting-campaign', prospect.slug);
      await prospectService.initializeCache(testTenantId);

      // Meeting request reply
      const reply: Reply = {
        email_id: 'meeting-reply-123',
        from_email: 'lisa@meetingtest.com',
        subject: 'Re: Our conversation',
        body: "Yes, I'd love to schedule a call! Are you available Thursday or Friday afternoon?",
        received_at: new Date().toISOString(),
      };

      // Process reply
      const result = await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Verify meeting request detected
      expect(result.analysis?.intent).toBe('meeting_request');
      expect(result.meetingRequested).toBe(true);

      // Verify prospect stage is qualified
      const updatedProspect = await prospectService.readProspect(testTenantId, prospect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('qualified');

      // Verify response is queued (would include calendar availability)
      const pendingActions = await approvalQueueService.listPendingActions(testTenantId);
      const calendarResponse = pendingActions.find(a => a.target_email === 'lisa@meetingtest.com');
      expect(calendarResponse).toBeDefined();
    });
  });

  describe('Scheduler cycle with mixed actions', () => {
    it('processes multiple action types in single cycle', async () => {
      // Create campaign
      await campaignService.createCampaign(testTenantId, 'scheduler-mixed-campaign', '+18015551234', 'Mixed test');
      await campaignService.activateCampaign(testTenantId, 'scheduler-mixed-campaign');

      // Create multiple prospects at different stages
      const prospect1 = await prospectService.createProspect(testTenantId, {
        name: 'Prospect One',
        email: 'one@mixed.com',
        stage: 'contacted',
      });

      const prospect2 = await prospectService.createProspect(testTenantId, {
        name: 'Prospect Two',
        email: 'two@mixed.com',
        stage: 'contacted',
      });

      // Add to campaign
      await campaignService.addTargetByProspectSlug(testTenantId, 'scheduler-mixed-campaign', prospect1.slug);
      await campaignService.addTargetByProspectSlug(testTenantId, 'scheduler-mixed-campaign', prospect2.slug);
      await prospectService.initializeCache(testTenantId);

      // Create unprocessed reply for prospect1
      const unprocessedRepliesPath = path.join(stateFolder, 'unprocessed_replies.json');
      await fs.promises.writeFile(unprocessedRepliesPath, JSON.stringify({
        replies: [{
          email_id: 'mixed-reply-1',
          from_email: 'one@mixed.com',
          subject: 'Re: Hello',
          body: 'Sounds interesting, tell me more!',
          received_at: new Date().toISOString(),
        }],
      }, null, 2));

      // Queue and approve action for prospect2
      const actionId = await approvalQueueService.queueAction(testTenantId, {
        campaign_id: 'scheduler-mixed-campaign',
        campaign_name: 'scheduler-mixed-campaign',
        target_id: prospect2.slug,
        target_name: 'Prospect Two',
        target_email: 'two@mixed.com',
        action_type: 'send_email',
        channel: 'email',
        subject: 'Test',
        body: 'Test email body',
        reasoning: 'Test',
      });
      await approvalQueueService.approveActions(testTenantId, [actionId]);

      // Schedule for immediate send
      const pastTime = new Date(Date.now() - 1000);
      await responseTimingService.queueForSend(testTenantId, actionId, pastTime);

      // Run scheduler cycle
      const replyResult = await scheduler.processUnprocessedReplies(testTenantId);
      const sendResult = await scheduler.processScheduledSends(testTenantId);

      // Verify replies processed
      expect(replyResult.processed).toBe(1);

      // Verify sends processed
      expect(sendResult.sent).toBe(1);

      // Verify prospect1 stage updated
      const updatedProspect1 = await prospectService.readProspect(testTenantId, prospect1.slug);
      expect(updatedProspect1!.frontmatter.stage).toBe('replied');

      // Verify scheduled send marked complete
      const scheduled = await responseTimingService.getScheduledSends(testTenantId);
      const completedSend = scheduled.find(s => s.action_id === actionId);
      expect(completedSend?.status).toBe('sent');
    });
  });

  describe('Error recovery', () => {
    it('continues processing other items when single item fails', async () => {
      // Create campaign
      await campaignService.createCampaign(testTenantId, 'error-recovery-campaign', '+18015551234', 'Error test');
      await campaignService.activateCampaign(testTenantId, 'error-recovery-campaign');

      // Create two prospects
      const validProspect = await prospectService.createProspect(testTenantId, {
        name: 'Valid Prospect',
        email: 'valid@error.com',
        stage: 'contacted',
      });

      await campaignService.addTargetByProspectSlug(testTenantId, 'error-recovery-campaign', validProspect.slug);
      await prospectService.initializeCache(testTenantId);

      // Create two replies - one valid, one from unknown email
      const unprocessedRepliesPath = path.join(stateFolder, 'unprocessed_replies.json');
      await fs.promises.writeFile(unprocessedRepliesPath, JSON.stringify({
        replies: [
          {
            email_id: 'invalid-reply',
            from_email: 'unknown@nowhere.com', // Won't match any prospect
            subject: 'Re: Something',
            body: 'This is from unknown sender',
            received_at: new Date().toISOString(),
          },
          {
            email_id: 'valid-reply',
            from_email: 'valid@error.com',
            subject: 'Re: Hello',
            body: 'This is interesting!',
            received_at: new Date().toISOString(),
          },
        ],
      }, null, 2));

      // Process replies - should handle error gracefully
      const result = await scheduler.processUnprocessedReplies(testTenantId);

      // Should have processed the valid one
      expect(result.processed).toBeGreaterThanOrEqual(1);

      // Valid prospect should be updated
      const updatedProspect = await prospectService.readProspect(testTenantId, validProspect.slug);
      expect(updatedProspect!.frontmatter.stage).toBe('replied');
    });

    it('handles missing campaign gracefully', async () => {
      // Create prospect without campaign
      const orphanProspect = await prospectService.createProspect(testTenantId, {
        name: 'Orphan Prospect',
        email: 'orphan@test.com',
        stage: 'contacted',
      });

      await prospectService.initializeCache(testTenantId);

      // Create reply for orphan prospect
      const reply: Reply = {
        email_id: 'orphan-reply',
        from_email: 'orphan@test.com',
        subject: 'Re: Hello',
        body: 'This is interesting!',
        received_at: new Date().toISOString(),
      };

      // Should not throw, should handle gracefully
      const result = await replyProcessingService.processReplyWithProspect(testTenantId, reply);

      // Should process successfully (processed=true)
      expect(result.processed).toBe(true);
      // Should have analysis
      expect(result.analysis?.intent).toBeDefined();
      // Won't have responseDraftId since no campaign found, but shouldn't error
    });
  });

  describe('Campaign wizard to operational campaign', () => {
    it('creates fully functional campaign via wizard', async () => {
      // Start wizard
      const wizard = await wizardService.startWizard(testTenantId, 'wizard-integration-test');
      expect(wizard.status).toBe('in_progress');

      // Answer all questions
      let currentWizard = wizard;
      let question = await wizardService.getNextQuestion(testTenantId, currentWizard.id);

      while (question) {
        // Provide meaningful test answers
        const testAnswers: Record<string, string> = {
          industry: 'Software companies',
          company_size: '10-50 employees',
          geographic_targeting: 'United States',
          job_titles: 'CEO, CTO, VP Engineering',
          primary_problems: 'Slow development cycles',
          solution_description: 'We accelerate software delivery',
          differentiators: 'AI-powered automation',
          common_objections: 'Too expensive',
          tone: 'Professional but friendly',
        };

        const answer = testAnswers[question.key] || `Test answer for ${question.key}`;
        currentWizard = await wizardService.processAnswer(testTenantId, currentWizard.id, answer);
        question = await wizardService.getNextQuestion(testTenantId, currentWizard.id);
      }

      // Complete wizard
      await wizardService.completeWizard(testTenantId, currentWizard.id);

      // Verify campaign created
      const campaign = await campaignService.getCampaign(testTenantId, 'wizard-integration-test');
      expect(campaign).not.toBeNull();
      expect(campaign!.status).toBe('draft');

      // Verify all files exist
      const campaignFolder = path.join(campaignsFolder, 'wizard-integration-test');
      expect(fs.existsSync(path.join(campaignFolder, 'config.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'icp.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'playbook.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'sequence.md'))).toBe(true);
      expect(fs.existsSync(path.join(campaignFolder, 'targets.md'))).toBe(true);

      // Verify campaign can be activated
      await campaignService.activateCampaign(testTenantId, 'wizard-integration-test');
      const activeCampaign = await campaignService.getCampaign(testTenantId, 'wizard-integration-test');
      expect(activeCampaign!.status).toBe('active');

      // Verify prospects can be added
      const prospect = await prospectService.createProspect(testTenantId, {
        name: 'Wizard Test Prospect',
        email: 'wizard-test@example.com',
      });
      await campaignService.addTargetByProspectSlug(testTenantId, 'wizard-integration-test', prospect.slug);

      const targets = await campaignService.getTargetReferences(testTenantId, 'wizard-integration-test');
      expect(targets.length).toBe(1);
    });
  });
});
