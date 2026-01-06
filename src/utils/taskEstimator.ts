/**
 * Task Duration Estimator
 *
 * Estimates how long a CLI task will take based on message content.
 * Used to decide whether to run a task synchronously or queue it.
 */

// Keywords that indicate long-running tasks (likely >3 minutes)
const LONG_TASK_KEYWORDS = [
  'search harder',
  'deep scan',
  'all platforms',
  'thorough search',
  'check everywhere',
  'scan marketplace',
  'scan all',
  'browser automation',
  'scrape',
  'crawl',
];

// Keywords that indicate medium-length tasks (2-3 minutes)
const MEDIUM_TASK_KEYWORDS = [
  'browser',
  'browse',
  'search',
  'marketplace',
  'facebook marketplace',
  'craigslist',
  'offerup',
  'ksl',
  'ebay',
];

// Keywords that indicate quick tasks (<1 minute)
const QUICK_TASK_KEYWORDS = [
  'weather',
  'time',
  'reminder',
  'schedule',
  'hello',
  'hi',
  'thanks',
  'help',
];

// Platform names for counting
const PLATFORMS = [
  'facebook',
  'fb marketplace',
  'craigslist',
  'offerup',
  'ksl',
  'ebay',
  'amazon',
  'mercari',
  'poshmark',
];

// Duration constants (in milliseconds)
const DURATIONS = {
  QUICK: 60000,      // 1 minute
  MEDIUM: 180000,    // 3 minutes
  LONG: 300000,      // 5 minutes
  VERY_LONG: 600000, // 10 minutes
};

/**
 * Estimate task duration based on message content
 *
 * @param message - The user's message
 * @returns Estimated duration in milliseconds
 */
export function estimateTaskDuration(message: string): number {
  const lowerMsg = message.toLowerCase();

  // Check for quick tasks first (fast path)
  if (QUICK_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    // Unless it also contains long task keywords
    if (!LONG_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
      return DURATIONS.QUICK;
    }
  }

  // Check for explicit long task keywords
  if (LONG_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    return DURATIONS.LONG;
  }

  // Count platforms mentioned
  const platformCount = PLATFORMS.filter((p) => lowerMsg.includes(p)).length;

  if (platformCount >= 3) {
    return DURATIONS.VERY_LONG; // Multiple platforms = very long
  }

  if (platformCount >= 2) {
    return DURATIONS.LONG; // 2 platforms = long
  }

  // Check for medium-length keywords
  if (MEDIUM_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    return DURATIONS.MEDIUM;
  }

  // Default to medium for unknown tasks
  return DURATIONS.MEDIUM;
}

/**
 * Determine if a task should be run asynchronously
 *
 * @param message - The user's message
 * @param thresholdMs - The threshold for async processing (default: 3 minutes)
 * @returns true if task should be queued, false if it should run synchronously
 */
export function shouldRunAsync(message: string, thresholdMs: number = 180000): boolean {
  const estimated = estimateTaskDuration(message);
  return estimated >= thresholdMs;
}

/**
 * Get a human-readable estimate
 *
 * @param message - The user's message
 * @returns Object with estimate details
 */
export function getEstimate(message: string): {
  durationMs: number;
  durationMinutes: number;
  isLongTask: boolean;
  confidence: 'low' | 'medium' | 'high';
} {
  const durationMs = estimateTaskDuration(message);
  const durationMinutes = Math.ceil(durationMs / 60000);
  const isLongTask = durationMs >= DURATIONS.MEDIUM;

  // Confidence is higher if we matched specific keywords
  const lowerMsg = message.toLowerCase();
  let confidence: 'low' | 'medium' | 'high' = 'low';

  if (LONG_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    confidence = 'high';
  } else if (MEDIUM_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    confidence = 'medium';
  } else if (QUICK_TASK_KEYWORDS.some((kw) => lowerMsg.includes(kw))) {
    confidence = 'high';
  }

  return {
    durationMs,
    durationMinutes,
    isLongTask,
    confidence,
  };
}

/**
 * TaskEstimator class for dependency injection
 */
export class TaskEstimator {
  estimate(message: string): number {
    return estimateTaskDuration(message);
  }

  shouldRunAsync(message: string, thresholdMs?: number): boolean {
    return shouldRunAsync(message, thresholdMs);
  }

  getEstimate(message: string) {
    return getEstimate(message);
  }
}
