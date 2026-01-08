import * as fs from 'fs';
import * as path from 'path';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { CampaignService, Campaign, Target, CampaignStage } from './campaignService.js';
import { ApprovalQueueService, ActionType, QueuedAction } from './approvalQueueService.js';
import { UnsubscribeService } from './unsubscribeService.js';
import { TimelineService } from './timelineService.js';
import { MessageProcessor } from './messageProcessor.js';
import { ReplyProcessingService, Reply } from './replyProcessingService.js';
import { ProspectService, ProspectData } from './prospectService.js';
import { ResponseTimingService } from './responseTimingService.js';

/**
 * Pipeline health report for a campaign.
 */
export interface CampaignHealth {
  name: string;
  status: string;
  total_targets: number;
  by_stage: Record<CampaignStage, number>;
  stalled_count: number;
  pending_approvals: number;
  scheduled_sends: number;
}

/**
 * Stalled prospect info.
 */
export interface StalledProspect {
  prospect_slug: string;
  campaign_name: string;
  stage: CampaignStage;
  last_touch_at: string | null;
  days_since_activity: number;
}

/**
 * Daily send tracking data.
 */
interface DailySendsData {
  version: number;
  lastUpdated: string;
  sends: Record<string, Record<string, number>>; // campaignId -> date -> count
}

/**
 * CampaignScheduler processes active campaigns every 15 minutes.
 *
 * Enhanced cycle logic:
 * 1. Check for unprocessed replies -> analyze -> draft responses -> queue for approval
 * 2. Check scheduled sends ready -> execute send -> log to timeline
 * 3. Check follow-ups due -> draft follow-up -> queue for approval
 * 4. Update campaign metrics
 * 5. Report pipeline health (on-demand or daily)
 */
export class CampaignScheduler {
  private prisma: PrismaClient;
  private campaignService: CampaignService;
  private approvalQueue: ApprovalQueueService;
  private unsubscribeService: UnsubscribeService;
  private timelineService: TimelineService;
  private messageProcessor: MessageProcessor | null;
  private replyProcessor: ReplyProcessingService;
  private prospectService: ProspectService | null = null;
  private responseTimingService: ResponseTimingService | null = null;
  private projectRoot: string;
  private cronJob: ReturnType<typeof cron.schedule> | null = null;
  private isRunning = false;
  private isProcessing = false;

  constructor(
    prisma: PrismaClient,
    campaignService: CampaignService,
    approvalQueue: ApprovalQueueService,
    unsubscribeService: UnsubscribeService,
    timelineService: TimelineService,
    messageProcessor?: MessageProcessor,
    projectRoot?: string
  ) {
    this.prisma = prisma;
    this.campaignService = campaignService;
    this.approvalQueue = approvalQueue;
    this.unsubscribeService = unsubscribeService;
    this.timelineService = timelineService;
    this.messageProcessor = messageProcessor ?? null;
    this.projectRoot = projectRoot ?? process.cwd();
    this.replyProcessor = new ReplyProcessingService(
      campaignService,
      unsubscribeService,
      timelineService,
      this.projectRoot
    );
    // Set the approval queue service on the reply processor
    this.replyProcessor.setApprovalQueueService(approvalQueue);
  }

  /**
   * Set the ProspectService for prospect integration.
   */
  setProspectService(prospectService: ProspectService): void {
    this.prospectService = prospectService;
    this.replyProcessor.setProspectService(prospectService);
  }

  /**
   * Set the ResponseTimingService for scheduled sends.
   */
  setResponseTimingService(responseTimingService: ResponseTimingService): void {
    this.responseTimingService = responseTimingService;
  }

  /**
   * Get the path to unprocessed replies file.
   */
  private getUnprocessedRepliesPath(tenantId: string): string {
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'unprocessed_replies.json');
  }

  /**
   * Get the path to daily sends tracking file.
   */
  private getDailySendsPath(tenantId: string): string {
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'daily_sends.json');
  }

  /**
   * Load daily sends data.
   */
  private async loadDailySendsData(tenantId: string): Promise<DailySendsData> {
    const filePath = this.getDailySendsPath(tenantId);

    if (!fs.existsSync(filePath)) {
      const data: DailySendsData = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        sends: {},
      };

      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      return data;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as DailySendsData;
  }

  /**
   * Save daily sends data.
   */
  private async saveDailySendsData(tenantId: string, data: DailySendsData): Promise<void> {
    const filePath = this.getDailySendsPath(tenantId);
    data.lastUpdated = new Date().toISOString();
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Start the campaign scheduler (15-minute cron).
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('CampaignScheduler already running');
      return;
    }

    // Run every 15 minutes: */15 * * * *
    this.cronJob = cron.schedule('*/15 * * * *', async () => {
      await this.processCampaigns();
    });

    this.isRunning = true;
    logger.info('CampaignScheduler started (every 15 minutes)');
  }

  /**
   * Stop the campaign scheduler.
   */
  async stop(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    // Wait for any in-progress processing to complete
    const maxWait = 30000; // 30 seconds
    const startWait = Date.now();
    while (this.isProcessing && Date.now() - startWait < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    this.isRunning = false;
    logger.info('CampaignScheduler stopped');
  }

  /**
   * Process all active campaigns for all tenants.
   */
  async processCampaigns(): Promise<void> {
    if (this.isProcessing) {
      logger.debug('Campaign processing already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      logger.debug('Starting campaign processing cycle');

      // Get all tenants with campaigns
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });

      for (const tenant of tenants) {
        try {
          await this.processTenantCampaigns(tenant.id);
        } catch (error) {
          logger.error({ tenantId: tenant.id, error }, 'Error processing tenant campaigns');
        }
      }

      logger.debug('Campaign processing cycle completed');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process all active campaigns for a specific tenant.
   * Enhanced cycle:
   * Step 1: Check for unprocessed replies
   * Step 2: Process scheduled sends
   * Step 3: Check follow-ups due
   * Step 4: Process new outreach for targets
   * Step 5: Update metrics
   */
  async processTenantCampaigns(tenantId: string): Promise<void> {
    const campaigns = await this.campaignService.listCampaigns(tenantId);
    const activeCampaigns = campaigns.filter((c) => c.status === 'active');

    if (activeCampaigns.length === 0) {
      return;
    }

    logger.debug({ tenantId, campaignCount: activeCampaigns.length }, 'Processing active campaigns');

    // Step 1: Process unprocessed replies
    try {
      await this.processUnprocessedReplies(tenantId);
    } catch (error) {
      logger.error({ tenantId, error }, 'Error processing unprocessed replies');
    }

    // Step 2: Process scheduled sends
    try {
      await this.processScheduledSends(tenantId);
    } catch (error) {
      logger.error({ tenantId, error }, 'Error processing scheduled sends');
    }

    // Step 3: Process follow-ups
    try {
      await this.processFollowUps(tenantId);
    } catch (error) {
      logger.error({ tenantId, error }, 'Error processing follow-ups');
    }

    // Expire old pending actions
    await this.approvalQueue.expireOldActions(tenantId);

    // Step 4: Process new outreach
    for (const campaign of activeCampaigns) {
      try {
        await this.processOneCampaign(tenantId, campaign);
      } catch (error) {
        logger.error(
          { tenantId, campaignId: campaign.id, campaignName: campaign.name, error },
          'Error processing campaign'
        );
      }
    }
  }

  /**
   * Process unprocessed replies from state file.
   */
  async processUnprocessedReplies(tenantId: string): Promise<{ processed: number; errors: number }> {
    const filePath = this.getUnprocessedRepliesPath(tenantId);

    if (!fs.existsSync(filePath)) {
      return { processed: 0, errors: 0 };
    }

    let processed = 0;
    let errors = 0;

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      if (!data.replies || !Array.isArray(data.replies)) {
        return { processed: 0, errors: 0 };
      }

      const replies: Reply[] = data.replies;

      for (const reply of replies) {
        try {
          // Check if already processed
          if (await this.replyProcessor.isReplyProcessed(tenantId, reply.email_id)) {
            continue;
          }

          // Process with prospect integration
          const result = await this.replyProcessor.processReplyWithProspect(tenantId, reply);

          if (result.processed) {
            processed++;
          } else {
            errors++;
          }
        } catch (error) {
          logger.error({ tenantId, replyId: reply.email_id, error }, 'Error processing reply');
          errors++;
        }
      }

      // Clear processed replies from file
      if (processed > 0) {
        data.replies = [];
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
    } catch (error) {
      logger.error({ tenantId, error }, 'Error reading unprocessed replies file');
    }

    if (processed > 0) {
      logger.info({ tenantId, processed, errors }, 'Processed unprocessed replies');
    }

    return { processed, errors };
  }

  /**
   * Process scheduled sends that are ready.
   */
  async processScheduledSends(tenantId: string): Promise<{ sent: number; failed: number }> {
    if (!this.responseTimingService) {
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    try {
      const readyToSend = await this.responseTimingService.getReadyToSend(tenantId);

      for (const scheduled of readyToSend) {
        try {
          // Get the approved action
          const action = await this.approvalQueue.getAction(tenantId, scheduled.action_id);

          if (!action || action.status !== 'approved') {
            // Action was rejected or expired, cancel scheduled send
            await this.responseTimingService.cancelScheduledSend(tenantId, scheduled.action_id);
            continue;
          }

          // Execute the send (mark as executed in queue)
          // Note: Actual email sending would be done via Python tool
          await this.approvalQueue.markExecuted(tenantId, scheduled.action_id, true);
          await this.responseTimingService.markScheduledSendComplete(tenantId, scheduled.action_id);

          // Record the send in daily tracking
          await this.recordDailySend(tenantId, action.campaign_id);

          // Log to timeline
          await this.timelineService.logEvent(
            tenantId,
            'CAMPAIGN',
            `Sent email to ${action.target_email} for campaign ${action.campaign_name}`
          );

          // Log to campaign
          await this.campaignService.logCampaignEvent(
            tenantId,
            action.campaign_name,
            'EMAIL_SENT',
            `Email sent to ${action.target_name} (${action.target_email})`
          );

          sent++;
        } catch (error) {
          logger.error({ tenantId, actionId: scheduled.action_id, error }, 'Error sending scheduled email');
          failed++;
        }
      }
    } catch (error) {
      logger.error({ tenantId, error }, 'Error processing scheduled sends');
    }

    if (sent > 0) {
      logger.info({ tenantId, sent, failed }, 'Processed scheduled sends');
    }

    return { sent, failed };
  }

  /**
   * Process follow-ups for prospects that are due.
   */
  async processFollowUps(tenantId: string): Promise<{ proposed: number }> {
    let proposed = 0;

    try {
      const campaigns = await this.campaignService.listCampaigns(tenantId);
      const activeCampaigns = campaigns.filter((c) => c.status === 'active');

      for (const campaign of activeCampaigns) {
        const refs = await this.campaignService.getTargetReferences(tenantId, campaign.name);
        const minDaysBetween = campaign.config.settings.min_days_between_touches;
        const maxTouches = campaign.config.settings.max_touches_per_target;
        const now = new Date();

        for (const ref of refs) {
          // Skip if unsubscribed or terminal stages
          if (ref.unsubscribed) continue;
          if (ref.campaign_stage === 'won' || ref.campaign_stage === 'lost' || ref.campaign_stage === 'booked') {
            continue;
          }

          // Skip if no previous touch (not contacted yet)
          if (!ref.last_touch_at || ref.touch_count === 0) continue;

          // Skip if max touches reached
          if (ref.touch_count >= maxTouches) continue;

          // Check if follow-up is due
          const lastTouch = new Date(ref.last_touch_at);
          const daysSinceTouch = (now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24);

          if (daysSinceTouch >= minDaysBetween) {
            // Check if we already have a pending action for this target
            const pendingActions = await this.approvalQueue.listPendingActions(tenantId, campaign.id);
            const hasPending = pendingActions.some(a => a.target_id === ref.id || a.target_id === ref.prospect_slug);

            if (hasPending) continue;

            // Get prospect for context
            let prospect: ProspectData | null = null;
            if (this.prospectService) {
              prospect = await this.prospectService.readProspect(tenantId, ref.prospect_slug);
            }

            if (!prospect || !prospect.frontmatter.email) continue;

            // Queue follow-up action
            await this.approvalQueue.queueAction(tenantId, {
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              target_id: ref.prospect_slug,
              target_name: prospect.frontmatter.name,
              target_email: prospect.frontmatter.email,
              action_type: 'send_email',
              channel: 'email',
              subject: `Following up - ${campaign.config.goal}`,
              body: this.generateFollowUpMessage(prospect, campaign, ref.touch_count),
              reasoning: `Follow-up #${ref.touch_count + 1} - ${Math.floor(daysSinceTouch)} days since last contact`,
            });

            proposed++;
          }
        }
      }
    } catch (error) {
      logger.error({ tenantId, error }, 'Error processing follow-ups');
    }

    if (proposed > 0) {
      logger.info({ tenantId, proposed }, 'Proposed follow-ups');
    }

    return { proposed };
  }

  /**
   * Generate a follow-up message.
   */
  private generateFollowUpMessage(prospect: ProspectData, campaign: Campaign, touchCount: number): string {
    const firstName = prospect.frontmatter.name.split(' ')[0];
    const company = prospect.frontmatter.company || 'your company';

    if (touchCount === 1) {
      return `Hi ${firstName},

I wanted to follow up on my previous message. I'd love to learn more about how ${company} is approaching their current challenges.

Would you have 15 minutes this week for a quick call?

Best regards`;
    } else if (touchCount === 2) {
      return `Hi ${firstName},

I hope this finds you well. I wanted to reach out one more time regarding my previous emails.

I believe there could be a valuable opportunity here. Would you be open to a brief conversation?

Best regards`;
    } else {
      return `Hi ${firstName},

I know you're busy, so I'll keep this brief.

If now isn't the right time, I completely understand. But if there's any interest in discussing ${campaign.config.goal}, I'm here to help.

Best regards`;
    }
  }

  /**
   * Get daily send count for a campaign.
   */
  async getDailySendCount(tenantId: string, campaignId: string): Promise<number> {
    const data = await this.loadDailySendsData(tenantId);
    const today = new Date().toISOString().split('T')[0];

    if (!data.sends[campaignId]) {
      return 0;
    }

    return data.sends[campaignId][today] || 0;
  }

  /**
   * Record a daily send for a campaign.
   */
  private async recordDailySend(tenantId: string, campaignId: string): Promise<void> {
    const data = await this.loadDailySendsData(tenantId);
    const today = new Date().toISOString().split('T')[0];

    if (!data.sends[campaignId]) {
      data.sends[campaignId] = {};
    }

    data.sends[campaignId][today] = (data.sends[campaignId][today] || 0) + 1;

    await this.saveDailySendsData(tenantId, data);
  }

  /**
   * Get pipeline health report for all campaigns.
   */
  async getPipelineHealth(tenantId: string): Promise<{ campaigns: CampaignHealth[] }> {
    const campaigns = await this.campaignService.listCampaigns(tenantId);
    const health: CampaignHealth[] = [];

    for (const campaign of campaigns) {
      const refs = await this.campaignService.getTargetReferences(tenantId, campaign.name);
      const pendingActions = await this.approvalQueue.listPendingActions(tenantId, campaign.id);

      // Count by stage
      const byStage: Record<CampaignStage, number> = {
        identified: 0,
        researched: 0,
        contacted: 0,
        replied: 0,
        qualified: 0,
        booked: 0,
        won: 0,
        lost: 0,
      };

      for (const ref of refs) {
        byStage[ref.campaign_stage]++;
      }

      // Get scheduled sends count
      let scheduledSends = 0;
      if (this.responseTimingService) {
        const scheduled = await this.responseTimingService.getScheduledSends(tenantId);
        scheduledSends = scheduled.filter(s => s.status === 'pending').length;
      }

      // Get stalled count
      const stalled = await this.getStalledProspects(tenantId, 7, campaign.name);

      health.push({
        name: campaign.name,
        status: campaign.status,
        total_targets: refs.length,
        by_stage: byStage,
        stalled_count: stalled.length,
        pending_approvals: pendingActions.length,
        scheduled_sends: scheduledSends,
      });
    }

    return { campaigns: health };
  }

  /**
   * Get stalled prospects (no activity in X days).
   */
  async getStalledProspects(
    tenantId: string,
    daysThreshold: number,
    campaignName?: string
  ): Promise<StalledProspect[]> {
    const stalled: StalledProspect[] = [];
    const now = new Date();

    const campaigns = await this.campaignService.listCampaigns(tenantId);
    const activeCampaigns = campaignName
      ? campaigns.filter((c) => c.name === campaignName)
      : campaigns.filter((c) => c.status === 'active' || c.status === 'paused');

    for (const campaign of activeCampaigns) {
      const refs = await this.campaignService.getTargetReferences(tenantId, campaign.name);

      for (const ref of refs) {
        // Skip terminal stages
        if (ref.campaign_stage === 'won' || ref.campaign_stage === 'lost' || ref.campaign_stage === 'booked') {
          continue;
        }

        // Skip if no touch yet
        if (!ref.last_touch_at) continue;

        const lastTouch = new Date(ref.last_touch_at);
        const daysSinceActivity = (now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24);

        if (daysSinceActivity >= daysThreshold) {
          stalled.push({
            prospect_slug: ref.prospect_slug,
            campaign_name: campaign.name,
            stage: ref.campaign_stage,
            last_touch_at: ref.last_touch_at,
            days_since_activity: Math.floor(daysSinceActivity),
          });
        }
      }
    }

    return stalled;
  }

  /**
   * Process a single campaign.
   */
  private async processOneCampaign(tenantId: string, campaign: Campaign): Promise<void> {
    const targets = await this.campaignService.getTargetsForProcessing(tenantId, campaign.name);

    if (targets.length === 0) {
      logger.debug({ tenantId, campaignName: campaign.name }, 'No targets to process');
      return;
    }

    // Check daily limit
    const dailyLimit = campaign.config.settings.max_daily_outreach;
    const todayActionsCount = await this.getDailySendCount(tenantId, campaign.id);
    const pendingCount = (await this.approvalQueue.listPendingActions(tenantId, campaign.id)).length;
    const effectiveCount = todayActionsCount + pendingCount;
    const remainingToday = Math.max(0, dailyLimit - effectiveCount);

    if (remainingToday === 0) {
      logger.debug(
        { tenantId, campaignName: campaign.name, dailyLimit },
        'Daily outreach limit reached'
      );
      return;
    }

    // Process targets up to daily limit
    const targetsToProcess = targets.slice(0, remainingToday);
    let actionsQueued = 0;

    for (const target of targetsToProcess) {
      try {
        // Check if target is unsubscribed
        if (target.email && (await this.unsubscribeService.isUnsubscribed(tenantId, target.email))) {
          await this.campaignService.markUnsubscribed(tenantId, campaign.name, target.id);
          continue;
        }

        // Decide next action for this target
        const action = await this.decideNextAction(tenantId, campaign, target);

        if (action) {
          await this.approvalQueue.queueAction(tenantId, action);
          actionsQueued++;
        }
      } catch (error) {
        logger.error(
          { tenantId, campaignId: campaign.id, targetId: target.id, error },
          'Error processing target'
        );
      }
    }

    if (actionsQueued > 0) {
      // Log to timeline
      await this.timelineService.logEvent(
        tenantId,
        'CAMPAIGN',
        `${campaign.name}: ${actionsQueued} actions queued for approval`
      );

      // Log to campaign log
      await this.campaignService.logCampaignEvent(
        tenantId,
        campaign.name,
        'PROCESS_CYCLE',
        `Queued ${actionsQueued} actions for approval`
      );

      logger.info(
        { tenantId, campaignName: campaign.name, actionsQueued },
        'Campaign processing completed'
      );
    }
  }

  /**
   * Count actions queued/executed today for a campaign.
   */
  private async countTodayActions(tenantId: string, campaignId: string): Promise<number> {
    const pending = await this.approvalQueue.listPendingActions(tenantId, campaignId);
    const today = new Date().toISOString().split('T')[0];

    // Count actions queued today
    return pending.filter((a) => a.queued_at.startsWith(today)).length;
  }

  /**
   * Decide the next action for a target.
   * Uses AI to generate personalized outreach message.
   */
  private async decideNextAction(
    tenantId: string,
    campaign: Campaign,
    target: Target
  ): Promise<Omit<QueuedAction, 'id' | 'queued_at' | 'expires_at' | 'status'> | null> {
    // Determine channel based on target stage and available contact info
    const channel = this.selectChannel(campaign, target);
    if (!channel) {
      logger.debug(
        { tenantId, campaignId: campaign.id, targetId: target.id },
        'No suitable channel for target'
      );
      return null;
    }

    // Generate outreach message
    const message = await this.generateOutreachMessage(tenantId, campaign, target, channel);
    if (!message) {
      return null;
    }

    // Determine action type
    const actionType = this.channelToActionType(channel);

    return {
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      target_id: target.id,
      target_name: target.name,
      target_email: target.email,
      target_linkedin: target.linkedin,
      target_phone: target.phone,
      action_type: actionType,
      channel,
      subject: message.subject,
      body: message.body,
      reasoning: message.reasoning,
    };
  }

  /**
   * Select the best channel for reaching a target.
   */
  private selectChannel(campaign: Campaign, target: Target): string | null {
    const { channels } = campaign.config;

    // Priority: email > linkedin > sms > calls
    // But respect what contact info is available

    if (channels.email.enabled && target.email) {
      return 'email';
    }

    if (channels.linkedin.enabled && target.linkedin) {
      return 'linkedin';
    }

    if (channels.sms.enabled && target.phone) {
      return 'sms';
    }

    if (channels.calls.enabled && target.phone) {
      return 'call';
    }

    return null;
  }

  /**
   * Convert channel to action type.
   */
  private channelToActionType(channel: string): ActionType {
    switch (channel) {
      case 'email':
        return 'send_email';
      case 'linkedin':
        return 'send_linkedin';
      case 'sms':
        return 'send_sms';
      case 'call':
        return 'call';
      default:
        return 'send_email';
    }
  }

  /**
   * Generate an outreach message using AI.
   * Falls back to template if AI not available.
   */
  private async generateOutreachMessage(
    tenantId: string,
    campaign: Campaign,
    target: Target,
    channel: string
  ): Promise<{ subject?: string; body: string; reasoning: string } | null> {
    // If MessageProcessor is available, use AI to generate message
    if (this.messageProcessor) {
      // TODO: Use Claude to generate the message with buildAIPrompt()
      // For now, we'll use a template approach
    }

    // Template-based fallback
    return this.generateTemplateMessage(campaign, target, channel);
  }

  /**
   * Build AI prompt for message generation.
   */
  private buildAIPrompt(campaign: Campaign, target: Target, channel: string): string {
    const touchCount = target.touches.length;
    const isFollowUp = touchCount > 0;

    let prompt = `Generate a ${channel} outreach message for a sales campaign.

Campaign: ${campaign.name}
Goal: ${campaign.config.goal}

Target:
- Name: ${target.name}
- Title: ${target.title ?? 'Unknown'}
- Company: ${target.company ?? 'Unknown'}
- Stage: ${target.stage}
- Previous touches: ${touchCount}

${target.research?.summary ? `Research Summary:\n${target.research.summary}` : ''}

${isFollowUp ? 'This is a follow-up message. Reference previous outreach if appropriate.' : 'This is initial outreach. Make it personal and value-focused.'}

Guidelines:
- Keep it under 150 words
- Be professional but conversational
- Reference specific company news or achievements if known
- Include a clear call to action
- Avoid: "touching base", "just checking in", "circle back"

Output as JSON:
{
  "subject": "Email subject line (for email only)",
  "body": "The message body",
  "reasoning": "Brief explanation of why this message and timing"
}`;

    return prompt;
  }

  /**
   * Generate a template-based message (fallback).
   */
  private generateTemplateMessage(
    campaign: Campaign,
    target: Target,
    channel: string
  ): { subject?: string; body: string; reasoning: string } {
    const isFollowUp = target.touches.length > 0;
    const firstName = target.name.split(' ')[0];

    if (channel === 'email') {
      if (isFollowUp) {
        return {
          subject: `Following up - ${campaign.config.goal}`,
          body: `Hi ${firstName},

I wanted to follow up on my previous message. I'd love to learn more about how ${target.company ?? 'your company'} is approaching ${campaign.config.audience.description}.

Would you have 15 minutes this week for a quick call?

Best,`,
          reasoning: `Follow-up email after ${target.touches.length} previous touches with no response`,
        };
      } else {
        return {
          subject: `Quick question about ${target.company ?? 'your company'}`,
          body: `Hi ${firstName},

I came across ${target.company ?? 'your company'} and was impressed by what you're building.

I'm reaching out because ${campaign.config.goal}, and I think there could be a good fit here.

Would you be open to a brief conversation this week?

Best,`,
          reasoning: 'Initial outreach email based on campaign goal and target profile',
        };
      }
    }

    if (channel === 'linkedin') {
      if (isFollowUp) {
        return {
          body: `Hi ${firstName}, following up on my previous message. Would love to connect and chat about ${campaign.config.goal}. Let me know if you're interested!`,
          reasoning: 'LinkedIn follow-up message',
        };
      } else {
        return {
          body: `Hi ${firstName}, I came across your profile and thought we should connect. I'm interested in ${campaign.config.audience.description} - would love to chat!`,
          reasoning: 'Initial LinkedIn connection message',
        };
      }
    }

    if (channel === 'sms') {
      return {
        body: `Hi ${firstName}, this is a quick follow-up about ${campaign.config.goal}. Would you have a few minutes to chat this week?`,
        reasoning: 'SMS outreach message',
      };
    }

    // Default
    return {
      body: `Reaching out about ${campaign.config.goal}`,
      reasoning: 'Generic outreach message',
    };
  }

  /**
   * Manually trigger campaign processing (for testing).
   */
  async triggerProcessing(): Promise<void> {
    await this.processCampaigns();
  }

  /**
   * Process campaigns for a specific tenant (for testing).
   */
  async triggerTenantProcessing(tenantId: string): Promise<void> {
    await this.processTenantCampaigns(tenantId);
  }

  /**
   * Check for replies from campaign targets and update stages.
   */
  private async checkForReplies(tenantId: string): Promise<void> {
    try {
      // Get all campaigns to find target emails
      const campaigns = await this.campaignService.listCampaigns(tenantId);
      const activeCampaigns = campaigns.filter((c) => c.status === 'active' || c.status === 'paused');

      if (activeCampaigns.length === 0) {
        return;
      }

      // Build map of target emails to campaign/target info
      const targetEmails: Map<string, { campaignName: string; target: Target }> = new Map();

      for (const campaign of activeCampaigns) {
        const targetsData = await this.campaignService.getTargets(tenantId, campaign.name);
        if (!targetsData?.targets) continue;

        for (const target of targetsData.targets) {
          if (target.email && !target.unsubscribed) {
            targetEmails.set(target.email.toLowerCase(), {
              campaignName: campaign.name,
              target,
            });
          }
        }
      }

      if (targetEmails.size === 0) {
        return;
      }

      // Note: Actual email checking would be done via Python tool
      // This method prepares the data; the Python tool does Gmail API calls
      // For now, log that we would check for replies
      logger.debug(
        { tenantId, targetCount: targetEmails.size },
        'Would check for replies from campaign targets'
      );

      // The process_campaign_replies.py tool handles the actual email checking
      // It can be triggered manually or via scheduled task
      // Here we just ensure target data is ready for processing

    } catch (error) {
      logger.error({ tenantId, error }, 'Error checking for replies');
    }
  }

  /**
   * Process a reply from a campaign target.
   * Called when a reply is detected (via email webhook or manual check).
   */
  async processReply(
    tenantId: string,
    fromEmail: string,
    subject: string,
    body: string
  ): Promise<{ processed: boolean; action?: string }> {
    try {
      // Find the target by email
      const campaigns = await this.campaignService.listCampaigns(tenantId);

      for (const campaign of campaigns) {
        const targetsData = await this.campaignService.getTargets(tenantId, campaign.name);
        if (!targetsData?.targets) continue;

        const target = targetsData.targets.find(
          (t) => t.email?.toLowerCase() === fromEmail.toLowerCase()
        );

        if (target) {
          // Use reply processor to analyze and handle
          const result = await this.replyProcessor.processReply(tenantId, {
            email_id: `manual-${Date.now()}`,
            from_email: fromEmail,
            subject,
            body,
            received_at: new Date().toISOString(),
            campaign_id: campaign.name,
            target_id: target.id,
          });

          if (result.processed) {
            logger.info(
              {
                tenantId,
                campaignName: campaign.name,
                targetEmail: fromEmail,
                action: result.action_taken,
              },
              'Reply processed'
            );
          }

          return {
            processed: result.processed,
            action: result.action_taken,
          };
        }
      }

      logger.debug({ tenantId, fromEmail }, 'Reply from unknown sender (not a campaign target)');
      return { processed: false };
    } catch (error) {
      logger.error({ tenantId, fromEmail, error }, 'Error processing reply');
      return { processed: false };
    }
  }

  /**
   * Handle incoming email event (webhook).
   */
  async handleEmailEvent(
    tenantId: string,
    email: {
      id: string;
      from: string;
      subject: string;
      body: string;
      received_at: string;
    }
  ): Promise<{ processed: boolean; mode: 'immediate' | 'delayed' }> {
    // Check if sender is a prospect
    let prospect: ProspectData | null = null;
    if (this.prospectService) {
      prospect = await this.prospectService.findProspectByEmail(tenantId, email.from);
    }

    if (!prospect) {
      // Not a prospect - ignore
      logger.debug({ tenantId, from: email.from }, 'Email from non-prospect, ignoring');
      return { processed: false, mode: 'delayed' };
    }

    // Find the campaign for this prospect
    const campaigns = await this.campaignService.listCampaigns(tenantId);
    let campaignConfig: Campaign['config'] | null = null;

    for (const campaign of campaigns) {
      if (campaign.status === 'active' || campaign.status === 'paused') {
        const refs = await this.campaignService.getTargetReferences(tenantId, campaign.name);
        if (refs.some(r => r.prospect_slug === prospect!.slug)) {
          campaignConfig = campaign.config;
          break;
        }
      }
    }

    // Determine response mode
    const responseMode = campaignConfig?.settings.response_mode ?? 'delayed';

    if (responseMode === 'immediate') {
      // Process immediately
      const reply: Reply = {
        email_id: email.id,
        from_email: email.from,
        subject: email.subject,
        body: email.body,
        received_at: email.received_at,
      };

      const result = await this.replyProcessor.processReplyWithProspect(tenantId, reply);

      return { processed: result.processed, mode: 'immediate' };
    } else {
      // Delayed mode - log to unprocessed replies for scheduler
      const filePath = this.getUnprocessedRepliesPath(tenantId);
      let data = { replies: [] as Reply[] };

      if (fs.existsSync(filePath)) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        data = JSON.parse(content);
      }

      data.replies.push({
        email_id: email.id,
        from_email: email.from,
        subject: email.subject,
        body: email.body,
        received_at: email.received_at,
      });

      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      logger.debug({ tenantId, emailId: email.id }, 'Email logged for delayed processing');

      return { processed: true, mode: 'delayed' };
    }
  }
}
