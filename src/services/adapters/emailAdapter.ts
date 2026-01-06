import { PrismaClient, TriggerType, TriggerStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { decryptCredential, encryptCredential } from '../../utils/encryption.js';
import { getConfig } from '../../config/index.js';
import type { EventSourceAdapter, TriggerCallback, TriggerEvent, EventConfig } from '../../types/trigger.js';

const MIN_POLL_INTERVAL_MINUTES = 5;
const DEFAULT_POLL_INTERVAL_MINUTES = 15;

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  payload?: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

/**
 * EmailPollingAdapter - Polls Gmail API for new emails.
 *
 * Features:
 * - OAuth2 authentication per tenant
 * - Configurable filters (from, subject, unread)
 * - Debouncing to prevent duplicate triggers
 * - Minimum poll interval of 5 minutes
 */
export class EmailPollingAdapter implements EventSourceAdapter {
  name = 'email';
  private prisma: PrismaClient;
  private callback: TriggerCallback | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private processedMessageIds: Map<string, Set<string>> = new Map(); // Per-trigger message cache
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
      this.checkEmailTriggers().catch((error) => {
        logger.error({ error }, 'Error checking email triggers');
      });
    }, MIN_POLL_INTERVAL_MINUTES * 60 * 1000);

    // Initial check after 30 seconds (give time for service to fully start)
    setTimeout(() => {
      this.checkEmailTriggers().catch((error) => {
        logger.error({ error }, 'Error in initial email trigger check');
      });
    }, 30000);

    logger.info('EmailPollingAdapter started');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    this.processedMessageIds.clear();
    logger.info('EmailPollingAdapter stopped');
  }

  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  /**
   * Check all due email triggers.
   */
  private async checkEmailTriggers(): Promise<void> {
    const now = new Date();

    // Find active email triggers that are due for checking
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

    // Filter to only email event triggers
    const emailTriggers = triggers.filter((t) => {
      const config = t.config as unknown as EventConfig;
      return config.event_source === 'email';
    });

    if (emailTriggers.length === 0) {
      return;
    }

    logger.debug({ count: emailTriggers.length }, 'Checking email triggers');

    for (const trigger of emailTriggers) {
      try {
        await this.checkEmailsForTrigger(trigger);
      } catch (error) {
        logger.error({ triggerId: trigger.id, error }, 'Error checking emails for trigger');
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
          service_name: 'gmail_oauth',
        },
      },
    });

    if (!credentials) {
      logger.debug({ triggerId: trigger.id }, 'No Gmail OAuth credentials for tenant');
      return;
    }

    const oauthData = JSON.parse(decryptCredential(credentials.encrypted_value)) as {
      access_token: string;
      refresh_token: string;
      expiry_date: number;
    };

    // Check if token needs refresh (refresh 1 minute before expiry)
    if (Date.now() > oauthData.expiry_date - 60000) {
      const refreshedData = await this.refreshGmailToken(
        trigger.tenant_id,
        oauthData.refresh_token
      );
      if (!refreshedData) {
        logger.warn({ triggerId: trigger.id }, 'Failed to refresh Gmail token, skipping');
        return;
      }
      oauthData.access_token = refreshedData.access_token;
      oauthData.expiry_date = refreshedData.expiry_date;
    }

    // Build Gmail API query
    const query = this.buildGmailQuery(config.filters);
    const pollInterval = Math.max((config.debounce_seconds || DEFAULT_POLL_INTERVAL_MINUTES * 60) / 60, MIN_POLL_INTERVAL_MINUTES);

    try {
      // Fetch unread messages matching filters
      const messages = await this.fetchGmailMessages(oauthData.access_token, query);

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

      // Get full message details
      const fullMessage = await this.getGmailMessage(oauthData.access_token, message.id);

      // Extract email details
      const emailData = this.extractEmailData(fullMessage);

      logger.info({ triggerId: trigger.id, from: emailData.from, subject: emailData.subject }, 'Email trigger firing');

      // Create trigger event
      const event: TriggerEvent = {
        triggerId: trigger.id,
        tenantId: trigger.tenant_id,
        userPhone: trigger.user_phone,
        triggerType: TriggerType.EVENT,
        autonomy: trigger.autonomy as import('@prisma/client').AutonomyLevel,
        taskPrompt: trigger.task_prompt,
        payload: {
          source: 'email:gmail',
          data: emailData,
          metadata: {
            messageId: message.id,
            threadId: message.threadId,
          },
        },
        timestamp: new Date(),
      };

      // Invoke callback
      if (this.callback) {
        await this.callback(event);
      }

      // Clean up old processed IDs (keep last 100)
      if (processedIds.size > 100) {
        const arr = Array.from(processedIds);
        processedIds.clear();
        arr.slice(-100).forEach((id) => processedIds.add(id));
      }

      await this.updateNextCheckTime(trigger.id, pollInterval);
    } catch (error) {
      logger.error({ triggerId: trigger.id, error }, 'Error fetching Gmail messages');
      await this.updateNextCheckTime(trigger.id, pollInterval);
    }
  }

  /**
   * Build Gmail API search query from filters.
   */
  private buildGmailQuery(filters?: Record<string, unknown>): string {
    const parts: string[] = ['is:unread'];

    if (filters) {
      if (filters.from) {
        parts.push(`from:${filters.from}`);
      }
      if (filters.subject) {
        parts.push(`subject:${filters.subject}`);
      }
      if (filters.label) {
        parts.push(`label:${filters.label}`);
      }
      if (filters.has_attachment) {
        parts.push('has:attachment');
      }
      if (filters.newer_than) {
        parts.push(`newer_than:${filters.newer_than}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Fetch messages from Gmail API.
   */
  private async fetchGmailMessages(accessToken: string, query: string): Promise<Array<{ id: string; threadId: string }>> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status}`);
    }

    const data = (await response.json()) as GmailListResponse;
    return data.messages || [];
  }

  /**
   * Get full message details from Gmail API.
   */
  private async getGmailMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status}`);
    }

    return (await response.json()) as GmailMessage;
  }

  /**
   * Extract useful data from Gmail message.
   */
  private extractEmailData(message: GmailMessage): {
    from: string;
    to: string;
    subject: string;
    body: string;
    snippet: string;
  } {
    const headers = message.payload?.headers || [];

    const getHeader = (name: string): string => {
      const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    // Extract body
    let body = '';
    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    } else if (message.payload?.parts) {
      const textPart = message.payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }

    return {
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      body: body.substring(0, 1000), // Limit body length
      snippet: message.snippet,
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
   * Refresh Gmail OAuth token using the refresh token.
   * Updates the stored credentials with the new access token.
   */
  private async refreshGmailToken(
    tenantId: string,
    refreshToken: string
  ): Promise<{ access_token: string; expiry_date: number } | null> {
    const config = getConfig();

    if (!config.gmail) {
      logger.error('Gmail OAuth not configured (missing GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET)');
      return null;
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.gmail.clientId,
          client_secret: config.gmail.clientSecret,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error({ status: response.status, error }, 'Failed to refresh Gmail token');
        return null;
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        token_type: string;
      };

      const newExpiryDate = Date.now() + data.expires_in * 1000;

      // Update stored credentials with new access token
      const updatedOAuthData = {
        access_token: data.access_token,
        refresh_token: refreshToken,
        expiry_date: newExpiryDate,
      };

      await this.prisma.tenant_credentials.update({
        where: {
          tenant_id_service_name: {
            tenant_id: tenantId,
            service_name: 'gmail_oauth',
          },
        },
        data: {
          encrypted_value: encryptCredential(JSON.stringify(updatedOAuthData)),
          updated_at: new Date(),
        },
      });

      logger.info({ tenantId }, 'Gmail token refreshed successfully');

      return {
        access_token: data.access_token,
        expiry_date: newExpiryDate,
      };
    } catch (error) {
      logger.error({ tenantId, error }, 'Error refreshing Gmail token');
      return null;
    }
  }
}
