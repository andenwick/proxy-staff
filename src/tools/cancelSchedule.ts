import { Tool } from './types.js';

/**
 * Tool for canceling scheduled tasks.
 * Supports both exact ID match and fuzzy description match.
 */
export const cancelScheduleTool: Tool = {
  name: 'cancel_schedule',
  description:
    'Cancel a scheduled task by ID or by description. ' +
    'Use the list_schedules tool first to see task IDs.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'The exact ID of the task to cancel (from list_schedules)',
      },
      task_description: {
        type: 'string',
        description: 'A description to search for if you do not have the exact ID',
      },
    },
    required: [],
  },
  execute: async (input, context) => {
    const taskId = input.task_id as string | undefined;
    const taskDescription = input.task_description as string | undefined;

    if (!taskId && !taskDescription) {
      return 'Error: Please provide either a task_id or task_description to cancel.';
    }

    // Use transaction to atomically find and update (prevents race condition)
    type TransactionResult = { error: string } | { task: { id: string; task_prompt: string } };
    const result: TransactionResult = await context.prisma.$transaction(async (tx) => {
      let task;

      // Priority 1: Exact ID match
      if (taskId) {
        task = await tx.scheduled_tasks.findUnique({
          where: { id: taskId },
        });

        // Verify the task belongs to this user
        if (task && (task.tenant_id !== context.tenantId || task.user_phone !== context.senderPhone)) {
          return { error: 'Error: Task not found or you do not have permission to cancel it.' };
        }
      }

      // Priority 2: Fuzzy description match
      if (!task && taskDescription) {
        // Use case-insensitive contains search
        task = await tx.scheduled_tasks.findFirst({
          where: {
            tenant_id: context.tenantId,
            user_phone: context.senderPhone,
            enabled: true,
            task_prompt: {
              contains: taskDescription,
              mode: 'insensitive',
            },
          },
        });
      }

      if (!task) {
        return { error: 'Task not found. Use list_schedules to see your scheduled tasks.' };
      }

      if (!task.enabled) {
        return { error: 'This task has already been cancelled.' };
      }

      // Soft delete by setting enabled=false
      // This preserves the record for audit purposes
      await tx.scheduled_tasks.update({
        where: { id: task.id },
        data: { enabled: false },
      });

      return { task };
    });

    // Handle error cases
    if ('error' in result) {
      return result.error;
    }

    const truncatedPrompt =
      result.task.task_prompt.length > 50
        ? result.task.task_prompt.substring(0, 47) + '...'
        : result.task.task_prompt;

    return `Task cancelled successfully.\n\nTask ID: ${result.task.id}\nDescription: ${truncatedPrompt}`;
  },
};
