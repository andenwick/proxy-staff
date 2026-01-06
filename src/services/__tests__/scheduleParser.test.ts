import { parseSchedule, calculateNextRun } from '../scheduleParser.js';

describe('scheduleParser', () => {
  describe('parseSchedule - recurring patterns', () => {
    it('parses "every day at 9am" to cron expression 0 9 * * *', () => {
      const result = parseSchedule('every day at 9am');

      expect(result).not.toBeNull();
      expect(result?.isRecurring).toBe(true);
      expect(result?.cronExpr).toBe('0 9 * * *');
      expect(result?.runAt).toBeUndefined();
    });

    it('parses "every Monday at 2pm" to cron expression 0 14 * * 1', () => {
      const result = parseSchedule('every Monday at 2pm');

      expect(result).not.toBeNull();
      expect(result?.isRecurring).toBe(true);
      expect(result?.cronExpr).toBe('0 14 * * 1');
      expect(result?.runAt).toBeUndefined();
    });
  });

  describe('parseSchedule - one-time patterns', () => {
    it('parses "tomorrow at 3pm" to specific DateTime', () => {
      const result = parseSchedule('tomorrow at 3pm');

      expect(result).not.toBeNull();
      expect(result?.isRecurring).toBe(false);
      expect(result?.cronExpr).toBeUndefined();
      expect(result?.runAt).toBeInstanceOf(Date);

      // Verify the hour is 15 (3pm)
      if (!result?.runAt) {
        throw new Error('Expected runAt to be defined');
      }
      const runAt = result.runAt;
      expect(runAt.getHours()).toBe(15);

      // Verify the date is tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(runAt.getDate()).toBe(tomorrow.getDate());
    });

    it('parses "in 2 hours" to relative DateTime calculation', () => {
      const beforeParse = new Date();
      const result = parseSchedule('in 2 hours');
      const afterParse = new Date();

      expect(result).not.toBeNull();
      expect(result?.isRecurring).toBe(false);
      expect(result?.cronExpr).toBeUndefined();
      expect(result?.runAt).toBeInstanceOf(Date);

      // Verify the time is approximately 2 hours from now (within a few seconds tolerance)
      if (!result?.runAt) {
        throw new Error('Expected runAt to be defined');
      }
      const runAt = result.runAt;
      const expectedMinTime = beforeParse.getTime() + (2 * 60 * 60 * 1000) - 5000; // 2 hours minus 5 seconds tolerance
      const expectedMaxTime = afterParse.getTime() + (2 * 60 * 60 * 1000) + 5000; // 2 hours plus 5 seconds tolerance

      expect(runAt.getTime()).toBeGreaterThanOrEqual(expectedMinTime);
      expect(runAt.getTime()).toBeLessThanOrEqual(expectedMaxTime);
    });
  });

  describe('parseSchedule - unparseable input', () => {
    it('returns null for unparseable input', () => {
      const result = parseSchedule('gibberish nonsense xyz');

      expect(result).toBeNull();
    });
  });

  describe('calculateNextRun', () => {
    it('correctly computes next execution time with timezone', () => {
      // Test with "every day at 9am" in America/Denver timezone
      const cronExpr = '0 9 * * *';
      const timezone = 'America/Denver';

      const nextRun = calculateNextRun(cronExpr, timezone);

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getTime()).toBeGreaterThan(Date.now());

      // The result should be in the future
      const now = new Date();
      expect(nextRun > now).toBe(true);
    });
  });
});
