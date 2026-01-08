import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';
import { CampaignService, Target, CampaignStage, CampaignConfig } from './campaignService.js';
import { UnsubscribeService } from './unsubscribeService.js';
import { TimelineService } from './timelineService.js';
import { ProspectService, ProspectData, ProspectStage } from './prospectService.js';
import { ApprovalQueueService, ActionType } from './approvalQueueService.js';

export interface Reply {
  email_id: string;
  from_email: string;
  from_name?: string;
  subject: string;
  body: string;
  received_at: string;
  campaign_id?: string;
  target_id?: string;
}

export interface ReplyAnalysis {
  sentiment: 'positive' | 'negative' | 'neutral';
  intent: 'interested' | 'not_interested' | 'question' | 'meeting_request' | 'unsubscribe' | 'out_of_office' | 'unknown';
  confidence: number;
  suggested_stage?: string;
  suggested_action?: string;
  keywords_matched: string[];
}

export interface ReplyProcessingResult {
  processed: boolean;
  analysis?: ReplyAnalysis;
  action_taken?: string;
  error?: string;
  meetingRequested?: boolean;
  responseDraftId?: string;
}

/**
 * Patterns for detecting reply intent.
 */
const INTENT_PATTERNS = {
  interested: [
    'interested',
    'tell me more',
    'sounds good',
    'let\'s chat',
    'let\'s talk',
    'would love to',
    'yes please',
    'send me',
    'share more',
    'learn more',
    'curious about',
  ],
  meeting_request: [
    'schedule a call',
    'book a meeting',
    'set up a time',
    'calendar',
    'available',
    'free time',
    'next week',
    'this week',
    'tomorrow',
    'let\'s meet',
    '15 minutes',
    '30 minutes',
    'quick call',
  ],
  not_interested: [
    'not interested',
    'no thank you',
    'no thanks',
    'not a good fit',
    'not for us',
    'pass on this',
    'not right now',
    'maybe later',
    'not at this time',
    'we\'re all set',
    'already have',
    'using competitor',
  ],
  out_of_office: [
    'out of office',
    'on vacation',
    'away from',
    'limited access',
    'return on',
    'back on',
    'auto-reply',
    'automatic reply',
  ],
  question: [
    'how does',
    'what is',
    'can you explain',
    'more information',
    'how much',
    'pricing',
    'cost',
    'features',
    'capabilities',
    '?',
  ],
};

/**
 * Stage transitions based on reply intent.
 */
const STAGE_TRANSITIONS: Record<string, ProspectStage | null> = {
  interested: 'replied',
  meeting_request: 'qualified',
  not_interested: 'lost',
  unsubscribe: 'lost',
  out_of_office: null, // No change
  question: 'replied',
  unknown: 'replied',
};

/**
 * ReplyProcessingService handles detecting and processing campaign replies.
 *
 * Enhanced to integrate with ProspectService for:
 * - Email lookup via prospect cache
 * - Stage updates synced to prospect files
 * - Interaction history tracking
 * - Response drafting and approval queue
 */
export class ReplyProcessingService {
  private projectRoot: string;
  private campaignService: CampaignService;
  private unsubscribeService: UnsubscribeService;
  private timelineService: TimelineService;
  private prospectService: ProspectService | null = null;
  private approvalQueueService: ApprovalQueueService | null = null;

  constructor(
    campaignService: CampaignService,
    unsubscribeService: UnsubscribeService,
    timelineService: TimelineService,
    projectRoot?: string
  ) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.campaignService = campaignService;
    this.unsubscribeService = unsubscribeService;
    this.timelineService = timelineService;
  }

  /**
   * Set the ProspectService for prospect integration.
   */
  setProspectService(prospectService: ProspectService): void {
    this.prospectService = prospectService;
  }

  /**
   * Set the ApprovalQueueService for response drafting.
   */
  setApprovalQueueService(approvalQueueService: ApprovalQueueService): void {
    this.approvalQueueService = approvalQueueService;
  }

  /**
   * Analyze reply content to determine intent and sentiment.
   */
  analyzeReply(content: string): ReplyAnalysis {
    const lowerContent = content.toLowerCase();
    const matchedKeywords: string[] = [];
    const intentScores: Record<string, number> = {};

    // Check for unsubscribe first (highest priority)
    const unsubscribePatterns = [
      'unsubscribe', 'stop emailing', 'stop contacting', 'remove me',
      'opt out', 'opt-out', 'do not contact', 'leave me alone',
    ];
    for (const pattern of unsubscribePatterns) {
      if (lowerContent.includes(pattern)) {
        matchedKeywords.push(pattern);
        return {
          sentiment: 'negative',
          intent: 'unsubscribe',
          confidence: 0.95,
          suggested_stage: 'lost',
          suggested_action: 'add_to_unsubscribe_list',
          keywords_matched: matchedKeywords,
        };
      }
    }

    // Score each intent
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      intentScores[intent] = 0;
      for (const pattern of patterns) {
        if (lowerContent.includes(pattern.toLowerCase())) {
          intentScores[intent]++;
          matchedKeywords.push(pattern);
        }
      }
    }

    // Find highest scoring intent
    let topIntent = 'unknown';
    let topScore = 0;
    for (const [intent, score] of Object.entries(intentScores)) {
      if (score > topScore) {
        topScore = score;
        topIntent = intent;
      }
    }

    // Determine sentiment and suggested action based on intent
    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    let suggestedStage: string | undefined;
    let suggestedAction: string | undefined;

    switch (topIntent) {
      case 'interested':
        sentiment = 'positive';
        suggestedStage = 'replied';
        suggestedAction = 'follow_up_with_details';
        break;
      case 'meeting_request':
        sentiment = 'positive';
        suggestedStage = 'qualified';
        suggestedAction = 'schedule_meeting';
        break;
      case 'not_interested':
        sentiment = 'negative';
        suggestedStage = 'lost';
        suggestedAction = 'close_target';
        break;
      case 'out_of_office':
        sentiment = 'neutral';
        suggestedAction = 'wait_and_retry';
        break;
      case 'question':
        sentiment = 'neutral';
        suggestedStage = 'replied';
        suggestedAction = 'answer_question';
        break;
      default:
        sentiment = 'neutral';
        suggestedStage = 'replied';
        suggestedAction = 'review_manually';
    }

    // Calculate confidence based on matches
    const confidence = Math.min(0.9, 0.3 + (topScore * 0.15));

    return {
      sentiment,
      intent: topIntent as ReplyAnalysis['intent'],
      confidence,
      suggested_stage: suggestedStage,
      suggested_action: suggestedAction,
      keywords_matched: matchedKeywords,
    };
  }

  /**
   * Match an email to a prospect via ProspectService lookup cache.
   * This is the preferred method for finding prospects by email.
   */
  async matchEmailToProspect(
    tenantId: string,
    fromEmail: string
  ): Promise<ProspectData | null> {
    if (!this.prospectService) {
      logger.warn({ tenantId }, 'ProspectService not set - falling back to campaign target lookup');
      return null;
    }

    return this.prospectService.findProspectByEmail(tenantId, fromEmail);
  }

  /**
   * Match an email to a campaign target (legacy method).
   */
  async matchEmailToTarget(
    tenantId: string,
    fromEmail: string
  ): Promise<{ campaign: string; target: Target } | null> {
    const campaigns = await this.campaignService.listCampaigns(tenantId);

    for (const campaign of campaigns) {
      if (campaign.status !== 'active' && campaign.status !== 'paused') {
        continue;
      }

      const targetsData = await this.campaignService.getTargets(tenantId, campaign.name);
      const targets = targetsData?.targets ?? [];

      for (const target of targets) {
        if (target.email && target.email.toLowerCase() === fromEmail.toLowerCase()) {
          return { campaign: campaign.name, target };
        }
      }
    }

    return null;
  }

  /**
   * Update prospect from reply - updates stage and adds to interaction history.
   */
  async updateProspectFromReply(
    tenantId: string,
    slug: string,
    reply: Reply,
    analysis: ReplyAnalysis
  ): Promise<void> {
    if (!this.prospectService) {
      logger.warn({ tenantId, slug }, 'ProspectService not set - cannot update prospect');
      return;
    }

    // Determine new stage based on intent
    const newStage = STAGE_TRANSITIONS[analysis.intent];

    // Build interaction history entry
    const timestamp = reply.received_at || new Date().toISOString();
    const date = timestamp.split('T')[0];
    const time = timestamp.split('T')[1]?.split('.')[0] || '';

    const historyEntry = `### ${date} ${time} - Reply received
**From:** ${reply.from_email}
**Subject:** ${reply.subject}
**Intent:** ${analysis.intent} (${analysis.sentiment}, confidence: ${analysis.confidence.toFixed(2)})
**Body Preview:** ${reply.body.substring(0, 200)}${reply.body.length > 200 ? '...' : ''}
**Action:** ${analysis.suggested_action}`;

    // Update prospect
    const updates: Record<string, unknown> = {
      interactionHistoryAppend: historyEntry,
    };

    // Only update stage if we have a valid transition (not null and not out_of_office)
    if (newStage !== null) {
      updates.stage = newStage;
    }

    await this.prospectService.updateProspect(tenantId, slug, updates);

    logger.debug({ tenantId, slug, intent: analysis.intent, newStage }, 'Prospect updated from reply');
  }

  /**
   * Draft a response to a reply using prospect context.
   * Returns the drafted response text.
   */
  draftResponse(
    prospect: ProspectData,
    reply: Reply,
    analysis: ReplyAnalysis,
    _campaign?: CampaignConfig
  ): { subject: string; body: string; reasoning: string } {
    const firstName = prospect.frontmatter.name.split(' ')[0];
    const company = prospect.frontmatter.company || 'your company';

    // Build response based on intent
    let subject: string;
    let body: string;
    let reasoning: string;

    switch (analysis.intent) {
      case 'interested':
        subject = `Re: ${reply.subject}`;
        body = `Hi ${firstName},

Thank you for your interest! I'd be happy to share more details.

${prospect.businessContext ? `Based on what I know about ${company}, ` : ''}I think we could help you with your goals.

Would you be open to a brief call to discuss your specific needs? I'm flexible on timing.

Best regards`;
        reasoning = 'Prospect expressed interest - following up with offer to discuss further';
        break;

      case 'meeting_request':
        subject = `Re: ${reply.subject}`;
        body = `Hi ${firstName},

Great, I'd love to schedule a call!

I have availability this week and next. What works best for you?

Alternatively, feel free to pick a time that works: [Calendar link placeholder]

Looking forward to speaking with you.

Best regards`;
        reasoning = 'Prospect requested a meeting - proposing to schedule';
        break;

      case 'question':
        subject = `Re: ${reply.subject}`;
        body = `Hi ${firstName},

Thanks for your question!

${reply.body.includes('pricing') || reply.body.includes('cost')
  ? 'Our pricing is customized based on your specific needs. I\'d be happy to put together a proposal after understanding more about your requirements.'
  : 'Let me address that for you.'}

Would it be helpful to jump on a quick call? I can walk you through everything in more detail.

Best regards`;
        reasoning = 'Prospect asked a question - acknowledging and offering to discuss';
        break;

      case 'out_of_office':
        subject = `Re: ${reply.subject}`;
        body = `Hi ${firstName},

No problem! I'll follow up when you're back.

Looking forward to connecting then.

Best regards`;
        reasoning = 'Out of office detected - acknowledging and will follow up later';
        break;

      default:
        subject = `Re: ${reply.subject}`;
        body = `Hi ${firstName},

Thanks for getting back to me.

I'd love to learn more about what you're looking for. Would you have time for a brief call?

Best regards`;
        reasoning = 'Generic response - asking to continue conversation';
    }

    return { subject, body, reasoning };
  }

  /**
   * Queue a drafted response for approval.
   */
  async queueResponseForApproval(
    tenantId: string,
    prospect: ProspectData,
    draft: { subject: string; body: string; reasoning: string },
    campaignId: string,
    campaignName: string
  ): Promise<string | null> {
    if (!this.approvalQueueService) {
      logger.warn({ tenantId }, 'ApprovalQueueService not set - cannot queue response');
      return null;
    }

    const actionId = await this.approvalQueueService.queueAction(tenantId, {
      campaign_id: campaignId,
      campaign_name: campaignName,
      target_id: prospect.slug,
      target_name: prospect.frontmatter.name,
      target_email: prospect.frontmatter.email,
      action_type: 'send_email' as ActionType,
      channel: 'email',
      subject: draft.subject,
      body: draft.body,
      reasoning: draft.reasoning,
    });

    logger.info({ tenantId, actionId, prospectSlug: prospect.slug }, 'Response queued for approval');

    return actionId;
  }

  /**
   * Process a reply with full prospect integration.
   * This is the enhanced method that:
   * 1. Matches email to prospect via lookup cache
   * 2. Analyzes reply intent
   * 3. Updates prospect stage and history
   * 4. Drafts and queues response for approval
   */
  async processReplyWithProspect(
    tenantId: string,
    reply: Reply
  ): Promise<ReplyProcessingResult> {
    try {
      validateTenantId(tenantId);

      // Step 1: Check for unsubscribe first
      const isUnsubscribe = await this.unsubscribeService.processReply(
        tenantId,
        reply.from_email,
        reply.body,
        reply.campaign_id
      );

      if (isUnsubscribe) {
        // Update prospect if we can find them
        const prospect = await this.matchEmailToProspect(tenantId, reply.from_email);
        if (prospect && this.prospectService) {
          await this.prospectService.updateProspect(tenantId, prospect.slug, {
            stage: 'lost',
            interactionHistoryAppend: `### ${new Date().toISOString().split('T')[0]} - Unsubscribed\nProspect requested to be removed from communications.`,
          });
        }

        await this.timelineService.logEvent(
          tenantId,
          'CAMPAIGN',
          `Unsubscribe detected from ${reply.from_email}`
        );

        return {
          processed: true,
          analysis: {
            sentiment: 'negative',
            intent: 'unsubscribe',
            confidence: 0.95,
            suggested_stage: 'lost',
            suggested_action: 'add_to_unsubscribe_list',
            keywords_matched: [],
          },
          action_taken: 'marked_unsubscribed',
        };
      }

      // Step 2: Analyze reply content
      const analysis = this.analyzeReply(reply.body);

      // Step 3: Find prospect by email
      let prospect = await this.matchEmailToProspect(tenantId, reply.from_email);
      let campaignMatch: { campaign: string; campaignConfig?: CampaignConfig } | null = null;

      // Try to find associated campaign
      const campaigns = await this.campaignService.listCampaigns(tenantId);
      for (const campaign of campaigns) {
        if (campaign.status === 'active' || campaign.status === 'paused') {
          const refs = await this.campaignService.getTargetReferences(tenantId, campaign.name);
          const hasProspect = prospect && refs.some(r => r.prospect_slug === prospect!.slug);
          if (hasProspect) {
            campaignMatch = { campaign: campaign.name, campaignConfig: campaign.config };
            break;
          }
        }
      }

      // Step 4: Update prospect if found
      if (prospect) {
        await this.updateProspectFromReply(tenantId, prospect.slug, reply, analysis);
      }

      // Step 5: Draft and queue response (if not out_of_office and not not_interested)
      let responseDraftId: string | null = null;
      const shouldDraftResponse =
        prospect &&
        campaignMatch &&
        analysis.intent !== 'out_of_office' &&
        analysis.intent !== 'not_interested' &&
        analysis.intent !== 'unsubscribe';

      if (shouldDraftResponse && prospect && campaignMatch) {
        const draft = this.draftResponse(prospect, reply, analysis, campaignMatch.campaignConfig);
        responseDraftId = await this.queueResponseForApproval(
          tenantId,
          prospect,
          draft,
          campaignMatch.campaignConfig?.id || campaignMatch.campaign,
          campaignMatch.campaign
        );
      }

      // Step 6: Log to timeline
      await this.timelineService.logEvent(
        tenantId,
        'CAMPAIGN',
        `Reply from ${reply.from_email}: ${analysis.intent} - ${analysis.suggested_action}`
      );

      // Mark reply as processed
      await this.markReplyProcessed(tenantId, reply.email_id);

      const result: ReplyProcessingResult = {
        processed: true,
        analysis,
        action_taken: prospect ? `prospect_updated_${analysis.suggested_stage || 'no_change'}` : 'analyzed_only',
        meetingRequested: analysis.intent === 'meeting_request',
      };

      if (responseDraftId) {
        result.responseDraftId = responseDraftId;
      }

      return result;
    } catch (error) {
      logger.error({ tenantId, reply, error }, 'Error processing reply with prospect');
      return {
        processed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process a reply from a campaign target (legacy method).
   */
  async processReply(
    tenantId: string,
    reply: Reply
  ): Promise<{
    processed: boolean;
    analysis?: ReplyAnalysis;
    action_taken?: string;
    error?: string;
  }> {
    try {
      validateTenantId(tenantId);

      // Check for unsubscribe first
      const isUnsubscribe = await this.unsubscribeService.processReply(
        tenantId,
        reply.from_email,
        reply.body,
        reply.campaign_id
      );

      if (isUnsubscribe) {
        // If campaign/target known, update stage
        if (reply.campaign_id && reply.target_id) {
          await this.campaignService.markUnsubscribed(
            tenantId,
            reply.campaign_id,
            reply.target_id
          );
        } else {
          // Try to find target by email
          const match = await this.matchEmailToTarget(tenantId, reply.from_email);
          if (match) {
            await this.campaignService.markUnsubscribed(
              tenantId,
              match.campaign,
              match.target.id
            );
          }
        }

        await this.timelineService.logEvent(
          tenantId,
          'CAMPAIGN',
          `Unsubscribe detected from ${reply.from_email}`
        );

        return {
          processed: true,
          analysis: {
            sentiment: 'negative',
            intent: 'unsubscribe',
            confidence: 0.95,
            suggested_stage: 'lost',
            suggested_action: 'add_to_unsubscribe_list',
            keywords_matched: [],
          },
          action_taken: 'marked_unsubscribed',
        };
      }

      // Analyze reply content
      const analysis = this.analyzeReply(reply.body);

      // Find campaign/target if not provided
      let campaignName = reply.campaign_id;
      let targetId = reply.target_id;

      if (!campaignName || !targetId) {
        const match = await this.matchEmailToTarget(tenantId, reply.from_email);
        if (match) {
          campaignName = match.campaign;
          targetId = match.target.id;
        }
      }

      // Update target based on analysis
      let actionTaken = 'analyzed_only';

      if (campaignName && targetId && analysis.suggested_stage) {
        // Get current target to check stage
        const targetsData = await this.campaignService.getTargets(tenantId, campaignName);
        const currentTarget = targetsData?.targets?.find(t => t.id === targetId);

        if (currentTarget) {
          const currentStageIndex = this.getStageIndex(currentTarget.stage);
          const suggestedStageIndex = this.getStageIndex(analysis.suggested_stage);

          // Only advance stage (don't go backwards except for 'lost')
          if (analysis.suggested_stage === 'lost' || suggestedStageIndex > currentStageIndex) {
            await this.campaignService.updateTargetStage(
              tenantId,
              campaignName,
              targetId,
              analysis.suggested_stage as CampaignStage
            );
            actionTaken = `stage_updated_to_${analysis.suggested_stage}`;
          }
        }

        // Log the reply event
        await this.campaignService.logCampaignEvent(
          tenantId,
          campaignName,
          'REPLY_RECEIVED',
          `Reply from ${reply.from_email}: ${analysis.intent} (${analysis.sentiment})`
        );
      }

      // Log to timeline
      await this.timelineService.logEvent(
        tenantId,
        'CAMPAIGN',
        `Reply from ${reply.from_email}: ${analysis.intent} - ${analysis.suggested_action}`
      );

      return {
        processed: true,
        analysis,
        action_taken: actionTaken,
      };
    } catch (error) {
      logger.error({ tenantId, reply, error }, 'Error processing reply');
      return {
        processed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get stage index for comparison.
   */
  private getStageIndex(stage: string): number {
    const stages = ['identified', 'researched', 'contacted', 'replied', 'qualified', 'booked', 'won', 'lost'];
    const index = stages.indexOf(stage);
    return index === -1 ? 0 : index;
  }

  /**
   * Process multiple replies in batch.
   */
  async processReplies(
    tenantId: string,
    replies: Reply[]
  ): Promise<{
    processed: number;
    unsubscribes: number;
    positive: number;
    negative: number;
    errors: number;
  }> {
    let processed = 0;
    let unsubscribes = 0;
    let positive = 0;
    let negative = 0;
    let errors = 0;

    for (const reply of replies) {
      const result = await this.processReply(tenantId, reply);

      if (result.processed) {
        processed++;
        if (result.analysis) {
          if (result.analysis.intent === 'unsubscribe') {
            unsubscribes++;
          } else if (result.analysis.sentiment === 'positive') {
            positive++;
          } else if (result.analysis.sentiment === 'negative') {
            negative++;
          }
        }
      } else {
        errors++;
      }
    }

    return { processed, unsubscribes, positive, negative, errors };
  }

  /**
   * Get path for storing processed reply IDs.
   */
  private getProcessedRepliesPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'processed_replies.json');
  }

  /**
   * Check if a reply has already been processed.
   */
  async isReplyProcessed(tenantId: string, emailId: string): Promise<boolean> {
    const filePath = this.getProcessedRepliesPath(tenantId);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.processed_ids?.includes(emailId) ?? false;
  }

  /**
   * Mark a reply as processed.
   */
  async markReplyProcessed(tenantId: string, emailId: string): Promise<void> {
    const filePath = this.getProcessedRepliesPath(tenantId);
    const stateDir = path.dirname(filePath);

    await fs.promises.mkdir(stateDir, { recursive: true });

    let data = { processed_ids: [] as string[], last_updated: '' };

    if (fs.existsSync(filePath)) {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      data = JSON.parse(content);
    }

    if (!data.processed_ids.includes(emailId)) {
      data.processed_ids.push(emailId);
      // Keep only last 1000 IDs
      if (data.processed_ids.length > 1000) {
        data.processed_ids = data.processed_ids.slice(-1000);
      }
    }

    data.last_updated = new Date().toISOString();

    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
