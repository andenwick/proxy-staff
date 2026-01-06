import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { CronExpressionParser } from 'cron-parser';
import { Tool } from './types.js';
import { parseSchedule, calculateNextRun } from '../services/scheduleParser.js';

const MAX_TASKS_PER_USER = 10;
const MIN_RECURRING_INTERVAL_MINUTES = 1; // 1 minute minimum for testing
const MIN_ONE_TIME_FUTURE_MINUTES = 1;

/**
 * Tool for scheduling recurring or one-time tasks.
 * Users can say things like "every day at 9am" or "tomorrow at 3pm".
 */
export const scheduleTaskTool: Tool = {
  name: 'schedule_task',
  description:
    'Schedule a task to run at a specific time or on a recurring schedule. ' +
    'Use task_type="reminder" for simple reminders (default), or task_type="execute" to perform actions. ' +
    'Recurring tasks have STATE: your last 5 outputs are saved and provided on each run, so you can continue sequences, counters, or build on previous results. ' +
    'When the task runs, your response is sent to the user via WhatsApp automatically. ' +
    'For "send me X" requests, store the exact message to send (e.g., task="hello" not "send hello to user"). ' +
    'Schedule examples: "every day at 9am", "every Monday at 2pm", "tomorrow at 3pm", "in 2 hours".',
  inputSchema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'The task description. For messages, use the exact text to send (e.g., "hello" not "send hello to user"). ' +
          'For actions requiring tools, describe what to do (e.g., "check emails and summarize important ones").',
      },
      schedule: {
        type: 'string',
        description:
          'When to run the task. Natural language like "every day at 9am", "tomorrow at 3pm", "in 2 hours"',
      },
      task_type: {
        type: 'string',
        enum: ['reminder', 'execute'],
        description:
          'Type of task: "reminder" just sends a reminder message (default), "execute" actually performs the action using available tools',
      },
      timezone: {
        type: 'string',
        description: 'Optional timezone (e.g., "America/New_York"). Defaults to America/Denver.',
      },
    },
    required: ['task', 'schedule'],
  },
  execute: async (input, context) => {
    const task = input.task as string;
    const schedule = input.schedule as string;
    const taskType = (input.task_type as string) || 'reminder';
    const timezone = (input.timezone as string) || 'America/Denver';

    if (!task || task.trim() === '') {
      return 'Error: Task description is required.';
    }

    if (!schedule || schedule.trim() === '') {
      return 'Error: Schedule is required.';
    }

    // Parse the schedule first (no DB access needed)
    const parsedSchedule = parseSchedule(schedule, timezone);

    if (!parsedSchedule) {
      return (
        'I could not understand that schedule. Please try again with a clearer format like ' +
        '"every day at 9am", "tomorrow at 3pm", or "in 2 hours".'
      );
    }

    let nextRunAt: Date;

    if (parsedSchedule.isRecurring) {
      // Validate minimum interval for recurring tasks
      // For cron expressions, we calculate the interval by comparing two consecutive runs
      const firstRun = calculateNextRun(parsedSchedule.cronExpr!, timezone);
      const secondRun = calculateNextRunAfter(parsedSchedule.cronExpr!, timezone, firstRun);
      const intervalMinutes = (secondRun.getTime() - firstRun.getTime()) / (1000 * 60);

      if (intervalMinutes < MIN_RECURRING_INTERVAL_MINUTES) {
        return `Error: Recurring tasks must have at least ${MIN_RECURRING_INTERVAL_MINUTES} minute between runs.`;
      }

      nextRunAt = firstRun;
    } else {
      // Validate one-time task is at least 1 minute in the future
      // Subtract 5 seconds buffer to account for parsing/execution time race condition
      const minFutureTime = new Date(Date.now() + (MIN_ONE_TIME_FUTURE_MINUTES * 60 - 5) * 1000);

      if (parsedSchedule.runAt! < minFutureTime) {
        return `Error: One-time tasks must be scheduled at least ${MIN_ONE_TIME_FUTURE_MINUTES} minute in the future.`;
      }

      // Round to the nearest minute boundary so scheduler (which polls at :00) catches it
      const runAt = parsedSchedule.runAt!;
      nextRunAt = new Date(Math.round(runAt.getTime() / 60000) * 60000);
    }

    // Use transaction to atomically check limit and create task (prevents race condition)
    const scheduledTask = await context.prisma.$transaction(async (tx) => {
      // Check user task limit within transaction
      const existingTaskCount = await tx.scheduled_tasks.count({
        where: {
          tenant_id: context.tenantId,
          user_phone: context.senderPhone,
          enabled: true,
        },
      });

      if (existingTaskCount >= MAX_TASKS_PER_USER) {
        throw new Error(`LIMIT_EXCEEDED:${MAX_TASKS_PER_USER}`);
      }

      // Build and create the scheduled task
      const createData: Prisma.scheduled_tasksUncheckedCreateInput = {
        id: crypto.randomUUID(),
        tenant_id: context.tenantId,
        user_phone: context.senderPhone,
        task_prompt: task,
        task_type: taskType,
        cron_expr: parsedSchedule.cronExpr || null,
        run_at: parsedSchedule.runAt || null,
        timezone: parsedSchedule.timezone,
        is_one_time: !parsedSchedule.isRecurring,
        next_run_at: nextRunAt,
        updated_at: new Date(),
      };

      return tx.scheduled_tasks.create({
        data: createData,
      });
    }).catch((error) => {
      // Handle limit exceeded error gracefully
      if (error instanceof Error && error.message.startsWith('LIMIT_EXCEEDED:')) {
        return null;
      }
      throw error;
    });

    // Handle limit exceeded case
    if (!scheduledTask) {
      return `Error: You have reached the maximum limit of ${MAX_TASKS_PER_USER} scheduled tasks. Please cancel some tasks before adding new ones.`;
    }

    const formattedTime = nextRunAt.toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    const scheduleType = parsedSchedule.isRecurring ? 'Recurring task' : 'One-time task';

    return (
      `${scheduleType} scheduled successfully!\n\n` +
      `Task ID: ${scheduledTask.id}\n` +
      `Description: ${task}\n` +
      `Next run: ${formattedTime}`
    );
  },
};

/**
 * Helper to calculate the next run after a given date.
 * Used for validating recurring task intervals.
 */
function calculateNextRunAfter(cronExpr: string, timezone: string, afterDate: Date): Date {
  const expression = CronExpressionParser.parse(cronExpr, {
    tz: timezone,
    currentDate: afterDate,
  });
  return expression.next().toDate();
}
