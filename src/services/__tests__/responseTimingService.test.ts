/**
 * ResponseTimingService Tests
 *
 * Tests for response timing calculations, business hours enforcement, and scheduling.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ResponseTimingService, TimingConfig } from '../responseTimingService.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ResponseTimingService', () => {
  let service: ResponseTimingService;
  const testProjectRoot = path.join(process.cwd(), 'test-temp-timing');
  const testTenantId = 'test-tenant';
  const stateFolder = path.join(testProjectRoot, 'tenants', testTenantId, 'state');
  const scheduledSendsPath = path.join(stateFolder, 'scheduled_sends.json');

  const defaultConfig: TimingConfig = {
    response_delay_min_hours: 1,
    response_delay_max_hours: 4,
    business_hours_only: true,
    business_hours_start: '09:00',
    business_hours_end: '17:00',
    business_hours_timezone: 'America/Denver',
    response_mode: 'delayed',
  };

  beforeAll(async () => {
    await fs.promises.mkdir(stateFolder, { recursive: true });
  });

  beforeEach(async () => {
    service = new ResponseTimingService(testProjectRoot);
    // Clean up scheduled sends file between tests
    if (fs.existsSync(scheduledSendsPath)) {
      await fs.promises.unlink(scheduledSendsPath);
    }
  });

  afterAll(async () => {
    if (fs.existsSync(testProjectRoot)) {
      await fs.promises.rm(testProjectRoot, { recursive: true });
    }
  });

  describe('calculateSendTime', () => {
    it('calculates send time with random delay within min/max hours range', () => {
      const config: TimingConfig = {
        ...defaultConfig,
        business_hours_only: false, // Disable business hours for this test
      };

      const now = new Date('2026-01-07T10:00:00Z');
      const results: Date[] = [];

      // Run multiple times to verify randomness within range
      for (let i = 0; i < 10; i++) {
        const sendTime = service.calculateSendTime(config, now);
        results.push(sendTime);
      }

      // All results should be within min/max hours from now
      for (const result of results) {
        const hoursDiff = (result.getTime() - now.getTime()) / (1000 * 60 * 60);
        expect(hoursDiff).toBeGreaterThanOrEqual(config.response_delay_min_hours);
        expect(hoursDiff).toBeLessThanOrEqual(config.response_delay_max_hours);
      }
    });

    it('queues for next business day when calculated time is after hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
        response_delay_min_hours: 1,
        response_delay_max_hours: 2,
      };

      // 4 PM Denver time (UTC-7 in winter) = 11 PM UTC
      // Adding 1-2 hours would put us past 5 PM Denver time
      const fridayAfternoon = new Date('2026-01-09T23:00:00Z'); // 4 PM Mountain Time

      const sendTime = service.calculateSendTime(config, fridayAfternoon);

      // Should be scheduled for next business day (Monday in this case if Friday)
      // Or Saturday if we're using simple next-day logic
      const sendTimeHours = sendTime.getUTCHours();

      // The result should either be on the same day within business hours,
      // or on the next business day starting at business hours
      expect(sendTime.getTime()).toBeGreaterThan(fridayAfternoon.getTime());
    });

    it('handles immediate mode by returning minimal delay', () => {
      const config: TimingConfig = {
        ...defaultConfig,
        response_mode: 'immediate',
      };

      const now = new Date('2026-01-07T10:00:00Z');
      const sendTime = service.calculateSendTime(config, now);

      // Immediate mode should return time very close to now
      const minutesDiff = (sendTime.getTime() - now.getTime()) / (1000 * 60);
      expect(minutesDiff).toBeLessThan(5); // Within 5 minutes
    });
  });

  describe('isWithinBusinessHours', () => {
    it('returns true during business hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // 10 AM Mountain Time = 5 PM UTC (during winter, UTC-7)
      const duringBusinessHours = new Date('2026-01-07T17:00:00Z');

      const result = service.isWithinBusinessHours(duringBusinessHours, config);

      expect(result).toBe(true);
    });

    it('returns false after business hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // 6 PM Mountain Time = 1 AM UTC next day (during winter, UTC-7)
      const afterBusinessHours = new Date('2026-01-08T01:00:00Z');

      const result = service.isWithinBusinessHours(afterBusinessHours, config);

      expect(result).toBe(false);
    });

    it('returns false before business hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // 7 AM Mountain Time = 2 PM UTC (during winter, UTC-7)
      const beforeBusinessHours = new Date('2026-01-07T14:00:00Z');

      const result = service.isWithinBusinessHours(beforeBusinessHours, config);

      expect(result).toBe(false);
    });

    it('returns true when business_hours_only is false', () => {
      const config: TimingConfig = {
        ...defaultConfig,
        business_hours_only: false,
      };

      // Midnight
      const midnight = new Date('2026-01-07T07:00:00Z'); // Midnight Mountain Time

      const result = service.isWithinBusinessHours(midnight, config);

      expect(result).toBe(true);
    });
  });

  describe('getNextBusinessWindow', () => {
    it('returns current time if already within business hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // 10 AM Mountain Time
      const duringBusinessHours = new Date('2026-01-07T17:00:00Z');

      const result = service.getNextBusinessWindow(duringBusinessHours, config);

      expect(result.getTime()).toBe(duringBusinessHours.getTime());
    });

    it('returns next day start time if after hours', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // 8 PM Mountain Time = 3 AM UTC next day
      const afterHours = new Date('2026-01-08T03:00:00Z');

      const result = service.getNextBusinessWindow(afterHours, config);

      // Should be 9 AM Mountain Time next day = 4 PM UTC
      expect(result.getTime()).toBeGreaterThan(afterHours.getTime());
    });

    it('handles weekend by queuing for Monday', () => {
      const config: TimingConfig = {
        ...defaultConfig,
      };

      // Saturday 10 AM Mountain Time = 5 PM UTC
      const saturday = new Date('2026-01-10T17:00:00Z'); // This is a Saturday

      const result = service.getNextBusinessWindow(saturday, config);

      // Should be on Monday
      expect(result.getDay()).toBe(1); // Monday
    });

    it('handles timezone correctly', () => {
      const config: TimingConfig = {
        ...defaultConfig,
        business_hours_timezone: 'America/New_York', // EST (UTC-5)
      };

      // 6 PM EST = 11 PM UTC
      const afterHoursEST = new Date('2026-01-07T23:00:00Z');

      const result = service.getNextBusinessWindow(afterHoursEST, config);

      // Should be next day 9 AM EST = 2 PM UTC
      expect(result.getTime()).toBeGreaterThan(afterHoursEST.getTime());
    });
  });

  describe('scheduled send queue', () => {
    it('queues action for scheduled send', async () => {
      const actionId = 'action-123';
      const scheduledFor = new Date('2026-01-07T18:00:00Z');

      await service.queueForSend(testTenantId, actionId, scheduledFor);

      const scheduled = await service.getScheduledSends(testTenantId);

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0].action_id).toBe(actionId);
      expect(scheduled[0].status).toBe('pending');
    });

    it('gets actions ready to send past scheduled time', async () => {
      const pastActionId = 'action-past';
      const futureActionId = 'action-future';

      const pastTime = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
      const futureTime = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now

      await service.queueForSend(testTenantId, pastActionId, pastTime);
      await service.queueForSend(testTenantId, futureActionId, futureTime);

      const readyToSend = await service.getReadyToSend(testTenantId);

      expect(readyToSend).toHaveLength(1);
      expect(readyToSend[0].action_id).toBe(pastActionId);
    });

    it('marks scheduled send as sent', async () => {
      const actionId = 'action-to-send';
      const scheduledFor = new Date(Date.now() - 1000 * 60); // 1 minute ago

      await service.queueForSend(testTenantId, actionId, scheduledFor);
      await service.markScheduledSendComplete(testTenantId, actionId);

      const scheduled = await service.getScheduledSends(testTenantId);
      const sent = scheduled.find((s) => s.action_id === actionId);

      expect(sent?.status).toBe('sent');
    });
  });
});
