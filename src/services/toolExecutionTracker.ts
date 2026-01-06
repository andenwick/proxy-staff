import { PrismaClient, Prisma } from '@prisma/client';

export class ToolExecutionTracker {
  constructor(private prisma: PrismaClient) {}

  /**
   * Start tracking a tool execution
   */
  async startExecution(
    tenantId: string,
    sessionId: string | null,
    toolName: string,
    toolType: 'tenant' | 'shared',
    inputPayload: Record<string, unknown>,
    directiveUsed?: string
  ): Promise<string> {
    const execution = await this.prisma.tool_executions.create({
      data: {
        tenant_id: tenantId,
        session_id: sessionId,
        tool_name: toolName,
        tool_type: toolType,
        input_payload: inputPayload as Prisma.InputJsonValue,
        status: 'PENDING',
        directive_used: directiveUsed,
      },
    });
    return execution.id;
  }

  /**
   * Complete a tool execution with result
   */
  async completeExecution(
    executionId: string,
    status: 'SUCCESS' | 'FAILURE' | 'TIMEOUT',
    outputPayload: unknown,
    durationMs: number,
    errorMessage?: string
  ): Promise<void> {
    await this.prisma.tool_executions.update({
      where: { id: executionId },
      data: {
        status,
        output_payload: outputPayload as Prisma.InputJsonValue,
        duration_ms: durationMs,
        error_message: errorMessage,
        completed_at: new Date(),
      },
    });
  }

  /**
   * Get execution statistics for a tenant
   */
  async getStats(tenantId: string, windowHours: number = 24): Promise<{
    total: number;
    success: number;
    failure: number;
    successRate: number;
    avgDurationMs: number;
  }> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const executions = await this.prisma.tool_executions.findMany({
      where: {
        tenant_id: tenantId,
        started_at: { gte: cutoff },
        status: { not: 'PENDING' },
      },
      select: {
        status: true,
        duration_ms: true,
      },
    });

    const total = executions.length;
    const success = executions.filter(e => e.status === 'SUCCESS').length;
    const failure = total - success;
    const successRate = total > 0 ? success / total : 1.0;
    const avgDurationMs = total > 0
      ? Math.round(executions.reduce((sum, e) => sum + (e.duration_ms || 0), 0) / total)
      : 0;

    return { total, success, failure, successRate, avgDurationMs };
  }

  /**
   * Get failing tools for a tenant
   */
  async getFailingTools(tenantId: string, windowHours: number = 24): Promise<Array<{
    toolName: string;
    failureCount: number;
    failureRate: number;
    recentErrors: string[];
  }>> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const executions = await this.prisma.tool_executions.findMany({
      where: {
        tenant_id: tenantId,
        started_at: { gte: cutoff },
        status: { not: 'PENDING' },
      },
      select: {
        tool_name: true,
        status: true,
        error_message: true,
      },
    });

    // Group by tool name
    const toolStats = new Map<string, { total: number; failures: number; errors: string[] }>();

    for (const exec of executions) {
      const stats = toolStats.get(exec.tool_name) || { total: 0, failures: 0, errors: [] };
      stats.total++;
      if (exec.status === 'FAILURE' || exec.status === 'TIMEOUT') {
        stats.failures++;
        if (exec.error_message && stats.errors.length < 5) {
          stats.errors.push(exec.error_message);
        }
      }
      toolStats.set(exec.tool_name, stats);
    }

    // Filter to failing tools (>10% failure rate)
    return Array.from(toolStats.entries())
      .filter(([_, stats]) => stats.failures > 0 && stats.failures / stats.total > 0.1)
      .map(([toolName, stats]) => ({
        toolName,
        failureCount: stats.failures,
        failureRate: stats.failures / stats.total,
        recentErrors: stats.errors,
      }))
      .sort((a, b) => b.failureRate - a.failureRate);
  }
}
