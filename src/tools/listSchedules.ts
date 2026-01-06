import { Tool } from './types.js';

/**
 * Tool for listing a user's scheduled tasks.
 */
export const listSchedulesTool: Tool = {
  name: 'list_schedules',
  description: 'List all your scheduled tasks and reminders with their next run times.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (input, context) => {
    const tasks = await context.prisma.scheduled_tasks.findMany({
      where: {
        tenant_id: context.tenantId,
        user_phone: context.senderPhone,
        enabled: true,
      },
      orderBy: {
        next_run_at: 'asc',
      },
    });

    if (tasks.length === 0) {
      return 'No scheduled tasks. Use the schedule_task tool to create one.';
    }

    const taskList = tasks.map((task) => {
      // Truncate task prompt for display
      const description =
        task.task_prompt.length > 50
          ? task.task_prompt.substring(0, 47) + '...'
          : task.task_prompt;

      // Format schedule info
      let scheduleInfo: string;
      if (task.is_one_time) {
        scheduleInfo = 'One-time';
      } else {
        scheduleInfo = `Recurring (${task.cron_expr})`;
      }

      // Format next run time
      const nextRun = task.next_run_at.toLocaleString('en-US', {
        timeZone: task.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });

      return (
        `ID: ${task.id}\n` +
        `  Task: ${description}\n` +
        `  Schedule: ${scheduleInfo}\n` +
        `  Next run: ${nextRun}`
      );
    });

    return `Scheduled Tasks (${tasks.length}):\n\n${taskList.join('\n\n')}`;
  },
};
