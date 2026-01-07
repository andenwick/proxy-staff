import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';
import { CampaignService, Target, CampaignStage } from './campaignService.js';
import { UnsubscribeService } from './unsubscribeService.js';
import { TimelineService } from './timelineService.js';

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
 * ReplyProcessingService handles detecting and processing campaign replies.
 */
export class ReplyProcessingService {
  private projectRoot: string;
  private campaignService: CampaignService;
  private unsubscribeService: UnsubscribeService;
  private timelineService: TimelineService;

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
   * Match an email to a campaign target.
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
   * Process a reply from a campaign target.
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
