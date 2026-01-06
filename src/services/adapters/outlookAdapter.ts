import { PrismaClient, TriggerType, TriggerStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { decryptCredential, encryptCredential } from '../../utils/encryption.js';
import { getConfig } from '../../config/index.js';
import type { EventSourceAdapter, TriggerCallback, TriggerEvent, EventConfig } from '../../types/trigger.js';

const MIN_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_POLL_INTERVAL_MINUTES = 15;

interface OutlookMessage {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  toRecipients: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  receivedDateTime: string;
  isRead: boolean;
  body?: {
    contentType: string;
    content: string;
  };
}

interface OutlookListResponse {
  value: OutlookMessage[];
  '@odata.nextLink'?: string;
}

/**
 * OutlookPollingAdapter - Polls Microsoft Graph API for new emails.
 *
 * Features:
 * - OAuth2 authentication per tenant (Microsoft identity platform)
 * - Configurable filters (from, subject, unread)
 * - Debouncing to prevent duplicate triggers
 * - Minimum poll interval of 5 minutes
 */
export class OutlookPollingAdapter implements EventSourceAdapter {
  name = 'outlook';
  private prisma: PrismaClient;
  private callback: TriggerCallback | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Map<string, Set<string>> = new Map();
  private isRunning: boolean = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Poll every 5 minutes for triggers that are due
    this.pollInterval = setInterval(() => {
      this.checkOutlookTriggers().catch((error) => {
        logger.error({ error }, 'Error checking Outlook triggers');
      });
    }, MIN_POLL_INTERVAL_MINUTES * 60 * 1000);

    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkOutlookTriggers().catch((error) => {
        logger.error({ error }, 'Error in initial Outlook trigger check');
      });
    }, 30000);

    logger.info('OutlookPollingAdapter started');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    this.processedMessageIds.clear();
    logger.info('OutlookPollingAdapter stopped');
  }

  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  /**
   * Check all due Outlook triggers.
   */
  private async checkOutlookTriggers(): Promise<void> {
    const now = new Date();

    const triggers = await this.prisma.triggers.findMany({
      where: {
        trigger_type: TriggerType.EVENT,
        status: TriggerStatus.ACTIVE,
        OR: [
          { next_check_at: null },
          { next_check_at: { lte: now } },
        ],
      },
    });

    // Filter to only Outlook event triggers
    const outlookTriggers = triggers.filter((t) => {
      const config = t.config as unknown as EventConfig;
      return config.event_source === 'outlook';
    });

    if (outlookTriggers.length === 0) {
      return;
    }

    logger.debug({ count: outlookTriggers.length }, 'Checking Outlook triggers');

    for (const trigger of outlookTriggers) {
      try {
        await this.checkEmailsForTrigger(trigger);
      } catch (error) {
        logger.error({ triggerId: trigger.id, error }, 'Error checking Outlook emails for trigger');
      }
    }
  }

  /**
   * Check emails for a single trigger.
   */
  private async checkEmailsForTrigger(trigger: {
    id: string;
    tenant_id: string;
    user_phone: string;
    config: unknown;
    task_prompt: string;
    autonomy: string;
    cooldown_seconds: number;
    last_triggered_at: Date | null;
  }): Promise<void> {
    const config = trigger.config as EventConfig;

    // Get OAuth token for this tenant
    const credentials = await this.prisma.tenant_credentials.findUnique({
      where: {
        tenant_id_service_name: {
          tenant_id: trigger.tenant_id,
          service_name: 'outlook_oauth',
        },
      },
    });

    if (!credentials) {
      logger.debug({ triggerId: trigger.id }, 'No Outlook OAuth credentials for tenant');
      return;
    }

    const oauthData = JSON.parse(decryptCredential(credentials.encrypted_value)) as {
      access_token: string;
      refresh_token: string;
      expiry_date: number;
    };

    // Check if token needs refresh (refresh 1 minute before expiry)
    if (Date.now() > oauthData.expiry_date - 60000) {
      const refreshedData = await this.refreshOutlookToken(
        trigger.tenant_id,
        oauthData.refresh_token
      );
      if (!refreshedData) {
        logger.warn({ triggerId: trigger.id }, 'Failed to refresh Outlook token, skipping');
        return;
      }
      oauthData.access_token = refreshedData.access_token;
      oauthData.expiry_date = refreshedData.expiry_date;
    }

    const pollInterval = Math.max(
      (config.debounce_seconds || DEFAULT_POLL_INTERVAL_MINUTES * 60) / 60,
      MIN_POLL_INTERVAL_MINUTES
    );

    try {
      // Fetch unread messages matching filters
      const messages = await this.fetchOutlookMessages(oauthData.access_token, config.filters);

      if (messages.length === 0) {
        await this.updateNextCheckTime(trigger.id, pollInterval);
        return;
      }

      // Get processed message IDs for this trigger
      if (!this.processedMessageIds.has(trigger.id)) {
        this.processedMessageIds.set(trigger.id, new Set());
      }
      const processedIds = this.processedMessageIds.get(trigger.id)!;

      // Filter out already processed messages
      const newMessages = messages.filter((m) => !processedIds.has(m.id));

      if (newMessages.length === 0) {
        await this.updateNextCheckTime(trigger.id, pollInterval);
        return;
      }

      // Process first new message (to avoid spam)
      const message = newMessages[0];
      processedIds.add(message.id);

      // Check cooldown
      if (trigger.last_triggered_at && trigger.cooldown_seconds > 0) {
        const cooldownEnd = new Date(trigger.last_triggered_at.getTime() + trigger.cooldown_seconds * 1000);
        if (new Date() < cooldownEnd) {
          logger.debug({ triggerId: trigger.id, cooldownEnd }, 'Trigger in cooldown');
          await this.updateNextCheckTime(trigger.id, pollInterval);
          return;
        }
      }

      // Extract email details
      const emailData = this.extractEmailData(message);

      logger.info({ triggerId: trigger.id, from: emailData.from, subject: emailData.subject }, 'Outlook trigger firing');

      // Create trigger event
      const event: TriggerEvent = {
        triggerId: trigger.id,
        tenantId: trigger.tenant_id,
        userPhone: trigger.user_phone,
        triggerType: TriggerType.EVENT,
        autonomy: trigger.autonomy as import('@prisma/client').AutonomyLevel,
        taskPrompt: trigger.task_prompt,
        payload: {
          source: 'email:outlook',
          data: emailData,
          metadata: {
            messageId: message.id,
            conversationId: message.conversationId,
          },
        },
        timestamp: new Date(),
      };

      // Invoke callback
      if (this.callback) {
        await this.callback(event);
      }

      // Mark the email as read to prevent duplicate triggers
      try {
        await this.markMessageAsRead(oauthData.access_token, message.id);
        logger.debug({ messageId: message.id }, 'Marked Outlook message as read');
      } catch (markError) {
        logger.error({ messageId: message.id, error: markError instanceof Error ? markError.message : String(markError) }, 'Failed to mark message as read');
      }

      // Clean up old processed IDs (keep last 100)
      if (processedIds.size > 100) {
        const arr = Array.from(processedIds);
        processedIds.clear();
        arr.slice(-100).forEach((id) => processedIds.add(id));
      }

      await this.updateNextCheckTime(trigger.id, pollInterval);
    } catch (error) {
      logger.error({ triggerId: trigger.id, error }, 'Error fetching Outlook messages');
      await this.updateNextCheckTime(trigger.id, pollInterval);
    }
  }

  /**
   * Fetch messages from Microsoft Graph API.
   */
  private async fetchOutlookMessages(
    accessToken: string,
    filters?: Record<string, unknown>
  ): Promise<OutlookMessage[]> {
    // Build OData filter query
    const filterParts: string[] = ['isRead eq false'];

    if (filters) {
      if (filters.from) {
        filterParts.push(`from/emailAddress/address eq '${filters.from}'`);
      }
      if (filters.subject) {
        filterParts.push(`contains(subject, '${filters.subject}')`);
      }
    }

    const filterQuery = filterParts.join(' and ');
    const url = `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filterQuery)}&$top=10&$orderby=receivedDateTime desc&$select=id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,body`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft Graph API error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as OutlookListResponse;
    return data.value || [];
  }

  /**
   * Mark a message as read in Outlook.
   */
  private async markMessageAsRead(accessToken: string, messageId: string): Promise<void> {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ isRead: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to mark message as read: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Extract useful data from Outlook message.
   */
  private extractEmailData(message: OutlookMessage): {
    from: string;
    fromName: string;
    to: string;
    subject: string;
    body: string;
    snippet: string;
    receivedAt: string;
  } {
    // Strip HTML tags from body if it's HTML
    let body = message.body?.content || message.bodyPreview || '';
    if (message.body?.contentType === 'html') {
      body = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return {
      from: message.from?.emailAddress?.address || '',
      fromName: message.from?.emailAddress?.name || '',
      to: message.toRecipients?.map((r) => r.emailAddress.address).join(', ') || '',
      subject: message.subject || '',
      body: body.substring(0, 1000), // Limit body length
      snippet: message.bodyPreview || '',
      receivedAt: message.receivedDateTime,
    };
  }

  /**
   * Update next check time for a trigger.
   */
  private async updateNextCheckTime(triggerId: string, intervalMinutes: number): Promise<void> {
    const nextCheckAt = new Date(Date.now() + intervalMinutes * 60 * 1000);
    await this.prisma.triggers.update({
      where: { id: triggerId },
      data: { next_check_at: nextCheckAt },
    });
  }

  /**
   * Refresh Outlook OAuth token using the refresh token.
   */
  private async refreshOutlookToken(
    tenantId: string,
    refreshToken: string
  ): Promise<{ access_token: string; expiry_date: number } | null> {
    const config = getConfig();

    if (!config.outlook) {
      logger.error('Outlook OAuth not configured (missing OUTLOOK_CLIENT_ID/OUTLOOK_CLIENT_SECRET)');
      return null;
    }

    try {
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.outlook.clientId,
          client_secret: config.outlook.clientSecret,
          scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Failed to refresh Outlook token');
        return null;
      }

      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
      };

      const newExpiryDate = Date.now() + data.expires_in * 1000;

      // Update stored credentials with new tokens
      const updatedOAuthData = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken, // Use new if provided, else keep old
        expiry_date: newExpiryDate,
      };

      await this.prisma.tenant_credentials.update({
        where: {
          tenant_id_service_name: {
            tenant_id: tenantId,
            service_name: 'outlook_oauth',
          },
        },
        data: {
          encrypted_value: encryptCredential(JSON.stringify(updatedOAuthData)),
          updated_at: new Date(),
        },
      });

      logger.info({ tenantId }, 'Outlook token refreshed successfully');

      return {
        access_token: data.access_token,
        expiry_date: newExpiryDate,
      };
    } catch (error) {
      logger.error({ tenantId, error }, 'Error refreshing Outlook token');
      return null;
    }
  }
}
