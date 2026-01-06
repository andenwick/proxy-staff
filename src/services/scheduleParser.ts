import * as chrono from 'chrono-node';
import { CronExpressionParser } from 'cron-parser';

/**
 * Parsed schedule result from natural language input.
 */
export interface ParsedSchedule {
  isRecurring: boolean;
  cronExpr?: string;
  runAt?: Date;
  timezone: string;
}

// Day name to cron day number mapping
const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Detect recurring keywords in input string.
 */
function isRecurringPattern(input: string): boolean {
  const lowerInput = input.toLowerCase();
  const recurringKeywords = ['every', 'daily', 'weekly', 'monthly', 'each'];
  return recurringKeywords.some((keyword) => lowerInput.includes(keyword));
}

/**
 * Extract hour in 24-hour format from time string (e.g., "9am" -> 9, "2pm" -> 14).
 */
function extractHour(input: string): number | null {
  const lowerInput = input.toLowerCase();

  // Match patterns like "9am", "9 am", "2pm", "2 pm", "14:00"
  const timeMatch = lowerInput.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!timeMatch) {
    return null;
  }

  let hour = parseInt(timeMatch[1], 10);
  const period = timeMatch[3];

  if (period === 'pm' && hour < 12) {
    hour += 12;
  } else if (period === 'am' && hour === 12) {
    hour = 0;
  }

  return hour;
}

/**
 * Extract day of week from input string.
 */
function extractDayOfWeek(input: string): number | null {
  const lowerInput = input.toLowerCase();
  for (const [dayName, dayNum] of Object.entries(DAY_MAP)) {
    if (lowerInput.includes(dayName)) {
      return dayNum;
    }
  }
  return null;
}

/**
 * Convert recurring pattern to cron expression.
 */
function convertToCron(input: string): string | null {
  const lowerInput = input.toLowerCase();

  // Minute-based patterns: "every minute", "every 1 minute", "every 5 minutes"
  const minuteMatch = lowerInput.match(/every\s*(\d+)?\s*minute/);
  if (minuteMatch) {
    const interval = parseInt(minuteMatch[1] || '1', 10);
    if (interval === 1) {
      return '* * * * *'; // Every minute
    } else {
      return `*/${interval} * * * *`; // Every N minutes
    }
  }

  const hour = extractHour(input);

  if (hour === null) {
    return null;
  }

  // Daily patterns: "every day at 9am", "daily at 9am"
  if (lowerInput.includes('every day') || lowerInput.includes('daily')) {
    return `0 ${hour} * * *`;
  }

  // Weekly patterns: "every Monday at 2pm", "weekly on Tuesday at 9am"
  const dayOfWeek = extractDayOfWeek(input);
  if (dayOfWeek !== null && (lowerInput.includes('every') || lowerInput.includes('weekly'))) {
    return `0 ${hour} * * ${dayOfWeek}`;
  }

  return null;
}

/**
 * Parse natural language schedule input into a structured schedule.
 *
 * @param input - Natural language schedule string (e.g., "every day at 9am", "tomorrow at 3pm")
 * @param timezone - Optional timezone (defaults to America/Denver)
 * @returns ParsedSchedule or null if input cannot be parsed
 */
export function parseSchedule(
  input: string,
  timezone: string = 'America/Denver'
): ParsedSchedule | null {
  if (!input || input.trim() === '') {
    return null;
  }

  const isRecurring = isRecurringPattern(input);

  if (isRecurring) {
    const cronExpr = convertToCron(input);
    if (cronExpr) {
      return {
        isRecurring: true,
        cronExpr,
        timezone,
      };
    }
    // Could not convert to cron expression
    return null;
  }

  // Try to parse as one-time schedule using chrono-node
  const parsedDate = chrono.parseDate(input);
  if (parsedDate) {
    return {
      isRecurring: false,
      runAt: parsedDate,
      timezone,
    };
  }

  // Could not parse input
  return null;
}

/**
 * Calculate the next run time for a cron expression.
 *
 * @param cronExpr - Cron expression string (e.g., "0 9 * * *")
 * @param timezone - IANA timezone string (e.g., "America/Denver")
 * @returns Next execution Date
 */
export function calculateNextRun(cronExpr: string, timezone: string): Date {
  const expression = CronExpressionParser.parse(cronExpr, {
    tz: timezone,
  });
  return expression.next().toDate();
}
