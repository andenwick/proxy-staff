import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

export type ResponseMode = 'delayed' | 'immediate';

export interface TimingConfig {
  response_delay_min_hours: number;
  response_delay_max_hours: number;
  business_hours_only: boolean;
  business_hours_start: string; // "HH:MM" format
  business_hours_end: string; // "HH:MM" format
  business_hours_timezone: string;
  response_mode: ResponseMode;
}

export interface ScheduledSend {
  action_id: string;
  scheduled_for: string;
  status: 'pending' | 'sent' | 'cancelled';
  created_at: string;
  sent_at?: string;
}

export interface ScheduledSendsData {
  version: number;
  lastUpdated: string;
  scheduled: ScheduledSend[];
}

/**
 * Default timing configuration.
 */
export const DEFAULT_TIMING_CONFIG: TimingConfig = {
  response_delay_min_hours: 1,
  response_delay_max_hours: 4,
  business_hours_only: true,
  business_hours_start: '09:00',
  business_hours_end: '17:00',
  business_hours_timezone: 'America/Denver',
  response_mode: 'delayed',
};

/**
 * ResponseTimingService handles natural response timing for campaign outreach.
 *
 * Features:
 * - Random delay within configurable min/max hours
 * - Business hours enforcement
 * - Weekend handling (queue for Monday)
 * - Timezone-aware scheduling
 */
export class ResponseTimingService {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Get the path to the scheduled sends file.
   */
  private getScheduledSendsPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'scheduled_sends.json');
  }

  /**
   * Load scheduled sends data.
   */
  private async loadScheduledSendsData(tenantId: string): Promise<ScheduledSendsData> {
    const filePath = this.getScheduledSendsPath(tenantId);

    if (!fs.existsSync(filePath)) {
      const data: ScheduledSendsData = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        scheduled: [],
      };

      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

      return data;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ScheduledSendsData;
  }

  /**
   * Save scheduled sends data.
   */
  private async saveScheduledSendsData(tenantId: string, data: ScheduledSendsData): Promise<void> {
    const filePath = this.getScheduledSendsPath(tenantId);
    data.lastUpdated = new Date().toISOString();
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Parse time string "HH:MM" to hours and minutes.
   */
  private parseTime(timeStr: string): { hours: number; minutes: number } {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return { hours, minutes };
  }

  /**
   * Get offset for timezone (simplified - uses fixed offset).
   * For production, use a proper timezone library like luxon or date-fns-tz.
   */
  private getTimezoneOffset(timezone: string): number {
    // Common US timezone offsets (winter time - standard time)
    const offsets: Record<string, number> = {
      'America/New_York': -5,
      'America/Chicago': -6,
      'America/Denver': -7,
      'America/Los_Angeles': -8,
      'America/Phoenix': -7,
      UTC: 0,
    };

    return offsets[timezone] ?? -7; // Default to Mountain Time
  }

  /**
   * Convert UTC date to local hours in a timezone.
   */
  private getLocalHours(date: Date, timezone: string): number {
    const offset = this.getTimezoneOffset(timezone);
    const utcHours = date.getUTCHours();
    let localHours = utcHours + offset;

    if (localHours < 0) localHours += 24;
    if (localHours >= 24) localHours -= 24;

    return localHours;
  }

  /**
   * Get local minutes in a timezone.
   */
  private getLocalMinutes(date: Date): number {
    return date.getUTCMinutes();
  }

  /**
   * Check if a date falls on a weekend.
   */
  private isWeekend(date: Date, timezone: string): boolean {
    // Adjust for timezone to get local day of week
    const offset = this.getTimezoneOffset(timezone);
    const localDate = new Date(date.getTime() + offset * 60 * 60 * 1000);
    const day = localDate.getUTCDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  /**
   * Calculate the send time based on timing configuration.
   */
  calculateSendTime(config: TimingConfig, fromTime?: Date): Date {
    const now = fromTime ?? new Date();

    // Immediate mode - return time with minimal delay
    if (config.response_mode === 'immediate') {
      return new Date(now.getTime() + 60 * 1000); // 1 minute delay
    }

    // Calculate random delay within range
    const minMs = config.response_delay_min_hours * 60 * 60 * 1000;
    const maxMs = config.response_delay_max_hours * 60 * 60 * 1000;
    const delayMs = minMs + Math.random() * (maxMs - minMs);

    let sendTime = new Date(now.getTime() + delayMs);

    // If business hours enforcement is enabled, adjust to next business window
    if (config.business_hours_only) {
      sendTime = this.getNextBusinessWindow(sendTime, config);
    }

    return sendTime;
  }

  /**
   * Check if a datetime is within business hours.
   */
  isWithinBusinessHours(datetime: Date, config: TimingConfig): boolean {
    // If business hours not enforced, always return true
    if (!config.business_hours_only) {
      return true;
    }

    // Check for weekend
    if (this.isWeekend(datetime, config.business_hours_timezone)) {
      return false;
    }

    const startTime = this.parseTime(config.business_hours_start);
    const endTime = this.parseTime(config.business_hours_end);

    const localHours = this.getLocalHours(datetime, config.business_hours_timezone);
    const localMinutes = this.getLocalMinutes(datetime);
    const localTimeMinutes = localHours * 60 + localMinutes;

    const startMinutes = startTime.hours * 60 + startTime.minutes;
    const endMinutes = endTime.hours * 60 + endTime.minutes;

    return localTimeMinutes >= startMinutes && localTimeMinutes < endMinutes;
  }

  /**
   * Find the next valid business window from a given datetime.
   */
  getNextBusinessWindow(datetime: Date, config: TimingConfig): Date {
    // If already within business hours, return as-is
    if (this.isWithinBusinessHours(datetime, config)) {
      return datetime;
    }

    const startTime = this.parseTime(config.business_hours_start);
    const offset = this.getTimezoneOffset(config.business_hours_timezone);

    // Start from the given datetime
    let candidate = new Date(datetime);

    // Try up to 7 days ahead (should always find a weekday)
    for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
      // Move to next day if not the first iteration
      if (dayOffset > 0) {
        candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
      }

      // Skip weekends
      if (this.isWeekend(candidate, config.business_hours_timezone)) {
        continue;
      }

      // Calculate business start time in UTC for this day
      // Local start time -> UTC start time
      const localMidnight = new Date(candidate);
      localMidnight.setUTCHours(0, 0, 0, 0);

      // Adjust to local timezone midnight
      const localMidnightAdjusted = new Date(localMidnight.getTime() - offset * 60 * 60 * 1000);

      // Add business start hours
      const businessStart = new Date(
        localMidnightAdjusted.getTime() + startTime.hours * 60 * 60 * 1000 + startTime.minutes * 60 * 1000
      );

      // If we're on the same day and the candidate is past the current time,
      // check if we're within business hours
      if (dayOffset === 0) {
        // For same day, check if current time is before business start
        if (datetime.getTime() < businessStart.getTime()) {
          return businessStart;
        }
        // If current time is after business hours, continue to next day
        continue;
      }

      // For future days, return business start time
      return businessStart;
    }

    // Fallback: return original datetime plus 1 day at business start
    const fallback = new Date(datetime.getTime() + 24 * 60 * 60 * 1000);
    return fallback;
  }

  /**
   * Queue an action for scheduled send.
   */
  async queueForSend(tenantId: string, actionId: string, scheduledFor: Date): Promise<void> {
    const data = await this.loadScheduledSendsData(tenantId);

    const scheduled: ScheduledSend = {
      action_id: actionId,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    data.scheduled.push(scheduled);
    await this.saveScheduledSendsData(tenantId, data);

    logger.debug({ tenantId, actionId, scheduledFor }, 'Action queued for scheduled send');
  }

  /**
   * Get all scheduled sends.
   */
  async getScheduledSends(tenantId: string): Promise<ScheduledSend[]> {
    const data = await this.loadScheduledSendsData(tenantId);
    return data.scheduled;
  }

  /**
   * Get actions that are ready to send (past scheduled time and still pending).
   */
  async getReadyToSend(tenantId: string): Promise<ScheduledSend[]> {
    const data = await this.loadScheduledSendsData(tenantId);
    const now = new Date();

    return data.scheduled.filter((s) => {
      return s.status === 'pending' && new Date(s.scheduled_for) <= now;
    });
  }

  /**
   * Mark a scheduled send as complete.
   */
  async markScheduledSendComplete(tenantId: string, actionId: string): Promise<void> {
    const data = await this.loadScheduledSendsData(tenantId);

    const scheduled = data.scheduled.find((s) => s.action_id === actionId);
    if (scheduled) {
      scheduled.status = 'sent';
      scheduled.sent_at = new Date().toISOString();
      await this.saveScheduledSendsData(tenantId, data);

      logger.debug({ tenantId, actionId }, 'Scheduled send marked as complete');
    }
  }

  /**
   * Cancel a scheduled send.
   */
  async cancelScheduledSend(tenantId: string, actionId: string): Promise<void> {
    const data = await this.loadScheduledSendsData(tenantId);

    const scheduled = data.scheduled.find((s) => s.action_id === actionId);
    if (scheduled && scheduled.status === 'pending') {
      scheduled.status = 'cancelled';
      await this.saveScheduledSendsData(tenantId, data);

      logger.debug({ tenantId, actionId }, 'Scheduled send cancelled');
    }
  }

  /**
   * Clean up old scheduled sends (keep last 100).
   */
  async cleanupOldScheduledSends(tenantId: string): Promise<number> {
    const data = await this.loadScheduledSendsData(tenantId);

    const originalCount = data.scheduled.length;

    // Keep only pending and last 100 sent/cancelled
    const pending = data.scheduled.filter((s) => s.status === 'pending');
    const completed = data.scheduled
      .filter((s) => s.status !== 'pending')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 100);

    data.scheduled = [...pending, ...completed];
    const removedCount = originalCount - data.scheduled.length;

    if (removedCount > 0) {
      await this.saveScheduledSendsData(tenantId, data);
      logger.info({ tenantId, removedCount }, 'Cleaned up old scheduled sends');
    }

    return removedCount;
  }
}
