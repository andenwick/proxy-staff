import { logger } from '../utils/logger.js';
import { TelegramService, TelegramConfig } from './messaging/telegram.js';
import { ProspectData } from './prospectService.js';
import { CampaignConfig } from './campaignService.js';
import { QueuedAction } from './approvalQueueService.js';

export type ApprovalType = 'NEW_PROSPECT' | 'EMAIL_READY';

export interface NotificationResult {
  messageId: string;
  sentAt: string;
}

export interface ApprovalReplyResult {
  approved: boolean;
  rejected: boolean;
  ambiguous: boolean;
  targetReference?: string;
}

interface NewProspectData {
  prospect: ProspectData;
  campaign: CampaignConfig;
}

interface EmailReadyData {
  action: QueuedAction;
  prospect: ProspectData;
  campaign: CampaignConfig;
}

/**
 * ApprovalNotificationService handles Telegram notifications for approval checkpoints.
 *
 * Two checkpoint types:
 * - NEW_PROSPECT: "Found John Smith, add to campaign?"
 * - EMAIL_READY: Full email draft with context for approval
 */
export class ApprovalNotificationService {
  private projectRoot: string;
  private telegramService: TelegramService;

  constructor(projectRoot?: string, telegramConfig?: TelegramConfig) {
    this.projectRoot = projectRoot ?? process.cwd();

    // Initialize TelegramService with provided config or environment
    const config = telegramConfig ?? {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    };
    this.telegramService = new TelegramService(config);
  }

  /**
   * Format an approval message based on type and data.
   * Uses Telegram HTML formatting.
   */
  formatApprovalMessage(type: ApprovalType, data: NewProspectData | EmailReadyData): string {
    if (type === 'NEW_PROSPECT') {
      return this.formatNewProspectMessage(data as NewProspectData);
    } else if (type === 'EMAIL_READY') {
      return this.formatEmailReadyMessage(data as EmailReadyData);
    }

    throw new Error(`Unknown approval type: ${type}`);
  }

  /**
   * Format NEW_PROSPECT notification message.
   */
  private formatNewProspectMessage(data: NewProspectData): string {
    const { prospect, campaign } = data;
    const { frontmatter } = prospect;

    const lines: string[] = [
      '<b>New Prospect Found</b>',
      '',
      `<b>Name:</b> ${frontmatter.name}`,
    ];

    if (frontmatter.company) {
      lines.push(`<b>Company:</b> ${frontmatter.company}`);
    }
    if (frontmatter.title) {
      lines.push(`<b>Title:</b> ${frontmatter.title}`);
    }
    if (frontmatter.email) {
      lines.push(`<b>Email:</b> ${frontmatter.email}`);
    }
    if (frontmatter.source) {
      lines.push(`<b>Source:</b> ${frontmatter.source}`);
    }

    lines.push('');
    lines.push(`<b>Campaign:</b> ${campaign.name}`);

    // Add business context if available (why they match ICP)
    if (prospect.businessContext) {
      lines.push('');
      lines.push('<b>Why they match ICP:</b>');
      lines.push(prospect.businessContext.substring(0, 500));
    }

    // Add research notes if available
    if (prospect.researchNotes) {
      lines.push('');
      lines.push('<b>Research Notes:</b>');
      lines.push(prospect.researchNotes.substring(0, 300));
    }

    lines.push('');
    lines.push('---');
    lines.push('Reply <b>approve</b> to add to campaign');
    lines.push('Reply <b>reject</b> to skip');

    return lines.join('\n');
  }

  /**
   * Format EMAIL_READY notification message.
   */
  private formatEmailReadyMessage(data: EmailReadyData): string {
    const { action, prospect, campaign } = data;
    const { frontmatter } = prospect;

    const lines: string[] = [
      '<b>Email Ready for Approval</b>',
      '',
      `<b>To:</b> ${frontmatter.name} (${action.target_email})`,
    ];

    if (frontmatter.company) {
      lines.push(`<b>Company:</b> ${frontmatter.company}`);
    }
    if (frontmatter.title) {
      lines.push(`<b>Title:</b> ${frontmatter.title}`);
    }

    lines.push('');
    lines.push(`<b>Campaign:</b> ${campaign.name}`);

    // Email subject
    if (action.subject) {
      lines.push('');
      lines.push(`<b>Subject:</b> ${action.subject}`);
    }

    // Email body
    lines.push('');
    lines.push('<b>Email:</b>');
    lines.push('<code>');
    lines.push(action.body);
    lines.push('</code>');

    // Personalization notes / reasoning
    if (action.reasoning) {
      lines.push('');
      lines.push('<b>Personalization notes:</b>');
      lines.push(`<i>${action.reasoning}</i>`);
    }

    // Prospect context for reference
    if (prospect.personalizationHooks) {
      lines.push('');
      lines.push('<b>Personalization hooks used:</b>');
      lines.push(`<i>${prospect.personalizationHooks.substring(0, 200)}</i>`);
    }

    lines.push('');
    lines.push('---');
    lines.push('Reply <b>approve</b> to send');
    lines.push('Reply <b>reject</b> to cancel');

    return lines.join('\n');
  }

  /**
   * Send notification for a new prospect found.
   */
  async notifyNewProspect(
    tenantId: string,
    prospect: ProspectData,
    campaign: CampaignConfig,
    chatId: string
  ): Promise<NotificationResult> {
    const message = this.formatApprovalMessage('NEW_PROSPECT', { prospect, campaign });

    try {
      const messageId = await this.telegramService.sendTextMessage(chatId, message);
      const sentAt = new Date().toISOString();

      logger.info(
        { tenantId, prospectSlug: prospect.slug, messageId },
        'New prospect notification sent'
      );

      return { messageId, sentAt };
    } catch (error) {
      logger.error(
        { tenantId, prospectSlug: prospect.slug, error },
        'Failed to send new prospect notification'
      );
      throw error;
    }
  }

  /**
   * Send notification for an email ready for approval.
   */
  async notifyEmailReady(
    tenantId: string,
    action: QueuedAction,
    prospect: ProspectData,
    campaign: CampaignConfig,
    chatId: string
  ): Promise<NotificationResult> {
    const message = this.formatApprovalMessage('EMAIL_READY', { action, prospect, campaign });

    try {
      const messageId = await this.telegramService.sendTextMessage(chatId, message);
      const sentAt = new Date().toISOString();

      logger.info(
        { tenantId, actionId: action.id, messageId },
        'Email ready notification sent'
      );

      return { messageId, sentAt };
    } catch (error) {
      logger.error(
        { tenantId, actionId: action.id, error },
        'Failed to send email ready notification'
      );
      throw error;
    }
  }

  /**
   * Parse an incoming Telegram message for approval intent.
   */
  parseApprovalReply(message: string): ApprovalReplyResult {
    const lowerMessage = message.toLowerCase().trim();

    // Approval patterns
    const approvalPatterns = [
      /^(yes|y)$/i,
      /^approve[d]?$/i,
      /^ok$/i,
      /^(looks?\s*good|lgtm)$/i,
      /^send(\s*it)?$/i,
      /^go(\s*ahead)?$/i,
      /^confirm(ed)?$/i,
    ];

    // Rejection patterns
    const rejectionPatterns = [
      /^(no|n)$/i,
      /^reject(ed)?$/i,
      /^skip$/i,
      /^(not\s*now)$/i,
      /^cancel(led)?$/i,
      /^don'?t(\s*send)?$/i,
      /^pass$/i,
    ];

    // Check for approval
    for (const pattern of approvalPatterns) {
      if (pattern.test(lowerMessage) || lowerMessage.startsWith('approve')) {
        // Try to extract target reference after "approve"
        const targetMatch = lowerMessage.match(/^approve\s+(.+)$/i);
        return {
          approved: true,
          rejected: false,
          ambiguous: false,
          targetReference: targetMatch ? targetMatch[1].trim() : undefined,
        };
      }
    }

    // Check for rejection
    for (const pattern of rejectionPatterns) {
      if (pattern.test(lowerMessage) || lowerMessage.startsWith('reject')) {
        // Try to extract target reference after "reject"
        const targetMatch = lowerMessage.match(/^reject\s+(.+)$/i);
        return {
          approved: false,
          rejected: true,
          ambiguous: false,
          targetReference: targetMatch ? targetMatch[1].trim() : undefined,
        };
      }
    }

    // Ambiguous - unclear intent
    return {
      approved: false,
      rejected: false,
      ambiguous: true,
    };
  }
}
