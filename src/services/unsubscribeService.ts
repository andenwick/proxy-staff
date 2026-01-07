import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

export interface UnsubscribeEntry {
  email: string;
  phone?: string;
  reason: 'auto_detected' | 'manual' | 'bounced' | 'complaint';
  source: string;
  keywords_matched?: string[];
  detected_at: string;
  campaign_id?: string;
}

export interface UnsubscribesData {
  version: number;
  lastUpdated: string;
  unsubscribed: UnsubscribeEntry[];
  patterns: string[];
}

/**
 * Default patterns for detecting unsubscribe requests.
 */
const DEFAULT_UNSUBSCRIBE_PATTERNS = [
  'unsubscribe',
  'stop emailing',
  'stop contacting',
  'remove me',
  'remove my email',
  'do not contact',
  'opt out',
  'opt-out',
  'stop messaging',
  'take me off',
  'not interested',
  "don't email",
  "don't contact",
  'leave me alone',
  'spam',
  'reported',
];

/**
 * UnsubscribeService manages opt-out detection and tracking.
 *
 * Unsubscribe data is stored at: tenants/{tenantId}/state/unsubscribes.json
 */
export class UnsubscribeService {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Get the path to the unsubscribes file.
   */
  private getUnsubscribesPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'unsubscribes.json');
  }

  /**
   * Load the unsubscribes data file.
   */
  private async loadUnsubscribesData(tenantId: string): Promise<UnsubscribesData> {
    const filePath = this.getUnsubscribesPath(tenantId);

    if (!fs.existsSync(filePath)) {
      // Initialize with default structure
      const data: UnsubscribesData = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        unsubscribed: [],
        patterns: DEFAULT_UNSUBSCRIBE_PATTERNS,
      };

      // Ensure state directory exists
      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });

      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as UnsubscribesData;
  }

  /**
   * Save the unsubscribes data file.
   */
  private async saveUnsubscribesData(tenantId: string, data: UnsubscribesData): Promise<void> {
    const filePath = this.getUnsubscribesPath(tenantId);
    data.lastUpdated = new Date().toISOString();
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Detect if content contains an unsubscribe request.
   * Returns matched keywords if detected, null otherwise.
   */
  async detectUnsubscribe(tenantId: string, content: string): Promise<string[] | null> {
    const data = await this.loadUnsubscribesData(tenantId);
    const lowerContent = content.toLowerCase();

    const matchedPatterns: string[] = [];

    for (const pattern of data.patterns) {
      if (lowerContent.includes(pattern.toLowerCase())) {
        matchedPatterns.push(pattern);
      }
    }

    if (matchedPatterns.length > 0) {
      logger.debug({ tenantId, matchedPatterns }, 'Unsubscribe patterns detected');
      return matchedPatterns;
    }

    return null;
  }

  /**
   * Check if content is an unsubscribe request (simple boolean).
   */
  async isUnsubscribeRequest(tenantId: string, content: string): Promise<boolean> {
    const patterns = await this.detectUnsubscribe(tenantId, content);
    return patterns !== null && patterns.length > 0;
  }

  /**
   * Add an email/phone to the unsubscribe list.
   */
  async addUnsubscribe(
    tenantId: string,
    email: string,
    reason: UnsubscribeEntry['reason'],
    source: string,
    campaignId?: string,
    keywordsMatched?: string[]
  ): Promise<void> {
    const data = await this.loadUnsubscribesData(tenantId);

    // Check if already unsubscribed
    const existing = data.unsubscribed.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );

    if (existing) {
      logger.debug({ tenantId, email }, 'Email already unsubscribed');
      return;
    }

    const entry: UnsubscribeEntry = {
      email: email.toLowerCase(),
      reason,
      source,
      detected_at: new Date().toISOString(),
      campaign_id: campaignId,
      keywords_matched: keywordsMatched,
    };

    data.unsubscribed.push(entry);
    await this.saveUnsubscribesData(tenantId, data);

    logger.info({ tenantId, email, reason, source }, 'Email added to unsubscribe list');
  }

  /**
   * Check if an email is unsubscribed.
   */
  async isUnsubscribed(tenantId: string, email: string): Promise<boolean> {
    const data = await this.loadUnsubscribesData(tenantId);
    return data.unsubscribed.some(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
  }

  /**
   * Check if a phone is unsubscribed.
   */
  async isPhoneUnsubscribed(tenantId: string, phone: string): Promise<boolean> {
    const data = await this.loadUnsubscribesData(tenantId);
    // Normalize phone number (remove non-digits)
    const normalizedPhone = phone.replace(/\D/g, '');
    return data.unsubscribed.some(
      (u) => u.phone && u.phone.replace(/\D/g, '') === normalizedPhone
    );
  }

  /**
   * Get all unsubscribed contacts.
   */
  async getUnsubscribed(tenantId: string): Promise<UnsubscribeEntry[]> {
    const data = await this.loadUnsubscribesData(tenantId);
    return data.unsubscribed;
  }

  /**
   * Get count of unsubscribed contacts.
   */
  async getUnsubscribedCount(tenantId: string): Promise<number> {
    const data = await this.loadUnsubscribesData(tenantId);
    return data.unsubscribed.length;
  }

  /**
   * Remove an email from the unsubscribe list (re-subscribe).
   */
  async removeUnsubscribe(tenantId: string, email: string): Promise<boolean> {
    const data = await this.loadUnsubscribesData(tenantId);
    const initialLength = data.unsubscribed.length;

    data.unsubscribed = data.unsubscribed.filter(
      (u) => u.email.toLowerCase() !== email.toLowerCase()
    );

    if (data.unsubscribed.length < initialLength) {
      await this.saveUnsubscribesData(tenantId, data);
      logger.info({ tenantId, email }, 'Email removed from unsubscribe list');
      return true;
    }

    return false;
  }

  /**
   * Get the unsubscribe patterns for a tenant.
   */
  async getPatterns(tenantId: string): Promise<string[]> {
    const data = await this.loadUnsubscribesData(tenantId);
    return data.patterns;
  }

  /**
   * Add a custom unsubscribe pattern.
   */
  async addPattern(tenantId: string, pattern: string): Promise<void> {
    const data = await this.loadUnsubscribesData(tenantId);

    const lowerPattern = pattern.toLowerCase();
    if (!data.patterns.includes(lowerPattern)) {
      data.patterns.push(lowerPattern);
      await this.saveUnsubscribesData(tenantId, data);
      logger.info({ tenantId, pattern }, 'Unsubscribe pattern added');
    }
  }

  /**
   * Remove a custom unsubscribe pattern.
   */
  async removePattern(tenantId: string, pattern: string): Promise<boolean> {
    const data = await this.loadUnsubscribesData(tenantId);
    const initialLength = data.patterns.length;

    const lowerPattern = pattern.toLowerCase();
    data.patterns = data.patterns.filter((p) => p.toLowerCase() !== lowerPattern);

    if (data.patterns.length < initialLength) {
      await this.saveUnsubscribesData(tenantId, data);
      logger.info({ tenantId, pattern }, 'Unsubscribe pattern removed');
      return true;
    }

    return false;
  }

  /**
   * Process an incoming reply and check for unsubscribe.
   * Returns true if unsubscribe was detected and handled.
   */
  async processReply(
    tenantId: string,
    email: string,
    content: string,
    campaignId?: string
  ): Promise<boolean> {
    const keywords = await this.detectUnsubscribe(tenantId, content);

    if (keywords && keywords.length > 0) {
      await this.addUnsubscribe(
        tenantId,
        email,
        'auto_detected',
        'email_reply',
        campaignId,
        keywords
      );
      return true;
    }

    return false;
  }
}
