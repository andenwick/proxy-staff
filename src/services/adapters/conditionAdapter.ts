import { PrismaClient, TriggerType, TriggerStatus } from '@prisma/client';
import { logger } from '../../utils/logger.js';
import { safeHttpRequest } from '../../utils/http.js';
import { extractValue } from '../../utils/objectPath.js';
import type { EventSourceAdapter, TriggerCallback, TriggerEvent, ConditionConfig, ComparisonOperator, ParsedCondition } from '../../types/trigger.js';

const MIN_POLL_INTERVAL_MINUTES = 1;
const DEFAULT_POLL_INTERVAL_MINUTES = 5;

/**
 * ConditionPollingAdapter - Polls external APIs and checks conditions.
 *
 * Features:
 * - Configurable poll intervals (min 1 minute)
 * - Safe expression evaluation (no eval)
 * - Edge detection: only fires when condition becomes true
 * - HTTP polling with timeout and error handling
 */
export class ConditionPollingAdapter implements EventSourceAdapter {
  name = 'condition';
  private prisma: PrismaClient;
  private callback: TriggerCallback | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastConditionStates: Map<string, boolean> = new Map();
  private isRunning: boolean = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Poll every minute for triggers that are due
    this.pollInterval = setInterval(() => {
      this.checkDueConditions().catch((error) => {
        logger.error({ error }, 'Error checking condition triggers');
      });
    }, 60000);

    // Initial check
    await this.checkDueConditions();

    logger.info('ConditionPollingAdapter started');
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    this.lastConditionStates.clear();
    logger.info('ConditionPollingAdapter stopped');
  }

  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  /**
   * Check all due condition triggers.
   */
  private async checkDueConditions(): Promise<void> {
    const now = new Date();

    // Find active condition triggers that are due for checking
    const triggers = await this.prisma.triggers.findMany({
      where: {
        trigger_type: TriggerType.CONDITION,
        status: TriggerStatus.ACTIVE,
        OR: [
          { next_check_at: null },
          { next_check_at: { lte: now } },
        ],
      },
    });

    if (triggers.length === 0) {
      return;
    }

    logger.debug({ count: triggers.length }, 'Checking condition triggers');

    for (const trigger of triggers) {
      try {
        await this.evaluateTrigger(trigger);
      } catch (error) {
        logger.error({ triggerId: trigger.id, error }, 'Error evaluating condition trigger');
      }
    }
  }

  /**
   * Evaluate a single condition trigger.
   */
  private async evaluateTrigger(trigger: {
    id: string;
    tenant_id: string;
    user_phone: string;
    config: unknown;
    task_prompt: string;
    autonomy: string;
    cooldown_seconds: number;
    last_triggered_at: Date | null;
  }): Promise<void> {
    const config = trigger.config as ConditionConfig;
    const pollInterval = Math.max(config.poll_interval_minutes || DEFAULT_POLL_INTERVAL_MINUTES, MIN_POLL_INTERVAL_MINUTES);

    // Calculate next check time
    const nextCheckAt = new Date(Date.now() + pollInterval * 60 * 1000);

    try {
      // Fetch data from source
      const data = await this.fetchDataSource(config);

      if (data === null) {
        // Update next check time even on error
        await this.prisma.triggers.update({
          where: { id: trigger.id },
          data: { next_check_at: nextCheckAt },
        });
        return;
      }

      // Extract value using path if specified
      let value: unknown = data;
      if (config.condition.extract_path) {
        value = extractValue(data, config.condition.extract_path);
      }

      // Evaluate condition
      const conditionMet = this.evaluateCondition(config.condition.expression, value);
      const previousState = this.lastConditionStates.get(trigger.id) ?? false;

      // Update stored state
      this.lastConditionStates.set(trigger.id, conditionMet);

      // Edge detection: only fire when condition becomes true (or always if not edge-triggered)
      const shouldFire = config.trigger_on_change_only
        ? (conditionMet && !previousState) // Edge: false -> true
        : conditionMet;

      if (shouldFire) {
        logger.info({ triggerId: trigger.id, value, expression: config.condition.expression }, 'Condition met, firing trigger');

        // Check cooldown
        if (trigger.last_triggered_at && trigger.cooldown_seconds > 0) {
          const cooldownEnd = new Date(trigger.last_triggered_at.getTime() + trigger.cooldown_seconds * 1000);
          if (new Date() < cooldownEnd) {
            logger.debug({ triggerId: trigger.id, cooldownEnd }, 'Trigger in cooldown');
            await this.prisma.triggers.update({
              where: { id: trigger.id },
              data: { next_check_at: nextCheckAt },
            });
            return;
          }
        }

        // Create trigger event
        const event: TriggerEvent = {
          triggerId: trigger.id,
          tenantId: trigger.tenant_id,
          userPhone: trigger.user_phone,
          triggerType: TriggerType.CONDITION,
          autonomy: trigger.autonomy as import('@prisma/client').AutonomyLevel,
          taskPrompt: trigger.task_prompt,
          payload: {
            source: `condition:${config.condition.expression}`,
            data: {
              currentValue: value,
              condition: config.condition.expression,
              rawData: data,
            },
          },
          timestamp: new Date(),
        };

        // Invoke callback
        if (this.callback) {
          await this.callback(event);
        }
      }

      // Update next check time
      await this.prisma.triggers.update({
        where: { id: trigger.id },
        data: { next_check_at: nextCheckAt },
      });
    } catch (error) {
      logger.error({ triggerId: trigger.id, error }, 'Error evaluating condition');

      // Still update next check time to prevent hammering
      await this.prisma.triggers.update({
        where: { id: trigger.id },
        data: { next_check_at: nextCheckAt },
      });
    }
  }

  /**
   * Fetch data from configured source.
   */
  private async fetchDataSource(config: ConditionConfig): Promise<unknown> {
    const { data_source } = config;

    if (data_source.type === 'http') {
      if (!data_source.url) {
        logger.warn('Condition data source missing URL');
        return null;
      }

      try {
        const response = await safeHttpRequest({
          url: data_source.url,
          method: data_source.method || 'GET',
          headers: data_source.headers,
          body: data_source.body,
          timeoutMs: 30000,
        });

        return response;
      } catch (error) {
        logger.error({ url: data_source.url, error }, 'Failed to fetch condition data source');
        return null;
      }
    }

    logger.warn({ type: data_source.type }, 'Unknown data source type');
    return null;
  }

  /**
   * Safe expression evaluation - NO eval(), only simple comparisons.
   */
  private evaluateCondition(expression: string, value: unknown): boolean {
    const parsed = this.parseCondition(expression);
    if (!parsed) {
      logger.warn({ expression }, 'Failed to parse condition expression');
      return false;
    }

    const { operator, right } = parsed;
    const numValue = typeof value === 'number' ? value : parseFloat(String(value));
    const numRight = typeof right === 'number' ? right : parseFloat(String(right));

    switch (operator) {
      case '<':
        return !isNaN(numValue) && !isNaN(numRight) && numValue < numRight;
      case '>':
        return !isNaN(numValue) && !isNaN(numRight) && numValue > numRight;
      case '<=':
        return !isNaN(numValue) && !isNaN(numRight) && numValue <= numRight;
      case '>=':
        return !isNaN(numValue) && !isNaN(numRight) && numValue >= numRight;
      case '==':
        return value == right;
      case '!=':
        return value != right;
      case 'contains':
        return String(value).includes(String(right));
      case 'startsWith':
        return String(value).startsWith(String(right));
      case 'endsWith':
        return String(value).endsWith(String(right));
      default:
        return false;
    }
  }

  /**
   * Parse a simple condition expression.
   */
  private parseCondition(expression: string): ParsedCondition | null {
    const operators: ComparisonOperator[] = ['<=', '>=', '!=', '==', '<', '>', 'contains', 'startsWith', 'endsWith'];

    for (const op of operators) {
      const index = expression.indexOf(op);
      if (index !== -1) {
        const left = expression.substring(0, index).trim();
        let right: string | number | boolean = expression.substring(index + op.length).trim();

        // Parse right side
        if (right.startsWith("'") && right.endsWith("'")) {
          right = right.slice(1, -1);
        } else if (right.startsWith('"') && right.endsWith('"')) {
          right = right.slice(1, -1);
        } else if (right === 'true') {
          right = true;
        } else if (right === 'false') {
          right = false;
        } else if (!isNaN(parseFloat(right))) {
          right = parseFloat(right);
        }

        return { left, operator: op, right };
      }
    }

    return null;
  }
}
