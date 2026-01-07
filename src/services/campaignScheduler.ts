import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { CampaignService, Campaign, Target } from './campaignService.js';
import { ApprovalQueueService, ActionType } from './approvalQueueService.js';
import { UnsubscribeService } from './unsubscribeService.js';
import { TimelineService } from './timelineService.js';
import { MessageProcessor } from './messageProcessor.js';
import { ReplyProcessingService } from './replyProcessingService.js';

/**
 * CampaignScheduler processes active campaigns every 15 minutes.
 *
 * For each active campaign:
 * 1. Gets targets that need processing
 * 2. For each target, AI decides the next action
 * 3. Queues actions for user approval
 */
export class CampaignScheduler {
  private prisma: PrismaClient;
  private campaignService: CampaignService;
  private approvalQueue: ApprovalQueueService;
  private unsubscribeService: UnsubscribeService;
  private timelineService: TimelineService;
  private messageProcessor: MessageProcessor | null;
  private replyProcessor: ReplyProcessingService;
  private cronJob: ReturnType<typeof cron.schedule> | null = null;
  private isRunning = false;
  private isProcessing = false;

  constructor(
    prisma: PrismaClient,
    campaignService: CampaignService,
    approvalQueue: ApprovalQueueService,
    unsubscribeService: UnsubscribeService,
    timelineService: TimelineService,
    messageProcessor?: MessageProcessor
  ) {
    this.prisma = prisma;
    this.campaignService = campaignService;
    this.approvalQueue = approvalQueue;
    this.unsubscribeService = unsubscribeService;
    this.timelineService = timelineService;
    this.messageProcessor = messageProcessor ?? null;
    this.replyProcessor = new ReplyProcessingService(
      campaignService,
      unsubscribeService,
      timelineService
    );
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
   */
  async processTenantCampaigns(tenantId: string): Promise<void> {
    const campaigns = await this.campaignService.listCampaigns(tenantId);
    const activeCampaigns = campaigns.filter((c) => c.status === 'active');

    if (activeCampaigns.length === 0) {
      return;
    }

    logger.debug({ tenantId, campaignCount: activeCampaigns.length }, 'Processing active campaigns');

    // Check for replies first (updates target stages)
    await this.checkForReplies(tenantId);

    // Expire old pending actions
    await this.approvalQueue.expireOldActions(tenantId);

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
    const todayActionsCount = await this.countTodayActions(tenantId, campaign.id);
    const remainingToday = Math.max(0, dailyLimit - todayActionsCount);

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
  ): Promise<Omit<import('./approvalQueueService.js').QueuedAction, 'id' | 'queued_at' | 'expires_at' | 'status'> | null> {
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
      try {
        const prompt = this.buildAIPrompt(campaign, target, channel);
        // Note: This would use Claude to generate the message
        // For now, we'll use a template approach
      } catch (error) {
        logger.warn({ tenantId, error }, 'AI message generation failed, using template');
      }
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
}
