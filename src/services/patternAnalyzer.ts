import { PrismaClient, ToolExecutionStatus, SignalType } from '@prisma/client';
import { logger } from '../utils/logger.js';

// Type for execution data returned from getExecutions query
interface ToolExecutionData {
  tool_name: string;
  status: ToolExecutionStatus;
  error_message: string | null;
  duration_ms: number | null;
}

// Type for signal data returned from getSignals query
interface FeedbackSignalData {
  signal_type: SignalType;
  signal_data: unknown;
  severity: string;
}

export interface AnalysisResult {
  tenantId: string;
  windowHours: number;
  analyzedAt: Date;

  // Tool performance
  failingTools: Array<{
    toolName: string;
    failureRate: number;
    failureCount: number;
    commonErrors: string[];
  }>;

  // Error patterns
  errorPatterns: Array<{
    pattern: string;
    occurrences: number;
    affectedTools: string[];
  }>;

  // User friction
  userFrictionPoints: Array<{
    type: 'correction' | 'complaint';
    count: number;
    samples: string[];
  }>;

  // Overall health
  overallHealth: {
    toolSuccessRate: number;
    userSatisfactionScore: number;
    signalCount: number;
    improvementNeeded: boolean;
  };

  // Recommendations
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    type: 'directive_update' | 'tool_fix' | 'config_change';
    description: string;
    targetFile?: string;
  }>;
}

export class PatternAnalyzer {
  constructor(private prisma: PrismaClient) {}

  /**
   * Run full analysis for a tenant
   */
  async analyze(tenantId: string, windowHours: number = 24): Promise<AnalysisResult> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    // Gather data
    const [executions, signals] = await Promise.all([
      this.getExecutions(tenantId, cutoff),
      this.getSignals(tenantId, cutoff),
    ]);

    // Analyze patterns
    const failingTools = this.analyzeFailingTools(executions);
    const errorPatterns = this.groupErrorPatterns(executions);
    const userFrictionPoints = this.analyzeUserFriction(signals);
    const overallHealth = this.calculateHealth(executions, signals);
    const recommendations = this.generateRecommendations(failingTools, errorPatterns, userFrictionPoints);

    return {
      tenantId,
      windowHours,
      analyzedAt: new Date(),
      failingTools,
      errorPatterns,
      userFrictionPoints,
      overallHealth,
      recommendations,
    };
  }

  private async getExecutions(tenantId: string, cutoff: Date): Promise<ToolExecutionData[]> {
    return this.prisma.tool_executions.findMany({
      where: { tenant_id: tenantId, started_at: { gte: cutoff } },
      select: {
        tool_name: true,
        status: true,
        error_message: true,
        duration_ms: true,
      },
    });
  }

  private async getSignals(tenantId: string, cutoff: Date): Promise<FeedbackSignalData[]> {
    return this.prisma.feedback_signals.findMany({
      where: { tenant_id: tenantId, created_at: { gte: cutoff } },
      select: {
        signal_type: true,
        signal_data: true,
        severity: true,
      },
    });
  }

  private analyzeFailingTools(executions: ToolExecutionData[]): AnalysisResult['failingTools'] {
    const toolStats = new Map<string, { total: number; failures: number; errors: string[] }>();

    for (const exec of executions) {
      const stats = toolStats.get(exec.tool_name) || { total: 0, failures: 0, errors: [] };
      stats.total++;
      if (exec.status === ToolExecutionStatus.FAILURE || exec.status === ToolExecutionStatus.TIMEOUT) {
        stats.failures++;
        if (exec.error_message && stats.errors.length < 5) {
          stats.errors.push(exec.error_message);
        }
      }
      toolStats.set(exec.tool_name, stats);
    }

    return Array.from(toolStats.entries())
      .filter(([_, stats]) => stats.total >= 3 && stats.failures / stats.total > 0.2)
      .map(([toolName, stats]) => ({
        toolName,
        failureRate: stats.failures / stats.total,
        failureCount: stats.failures,
        commonErrors: stats.errors,
      }))
      .sort((a, b) => b.failureRate - a.failureRate);
  }

  private groupErrorPatterns(executions: ToolExecutionData[]): AnalysisResult['errorPatterns'] {
    const patterns = new Map<string, { count: number; tools: Set<string> }>();

    for (const exec of executions) {
      if (exec.error_message) {
        // Normalize error message to find patterns
        const normalized = this.normalizeError(exec.error_message);
        const entry = patterns.get(normalized) || { count: 0, tools: new Set() };
        entry.count++;
        entry.tools.add(exec.tool_name);
        patterns.set(normalized, entry);
      }
    }

    return Array.from(patterns.entries())
      .filter(([_, data]) => data.count >= 2)
      .map(([pattern, data]) => ({
        pattern,
        occurrences: data.count,
        affectedTools: Array.from(data.tools),
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);
  }

  private normalizeError(error: string): string {
    // Remove specific values to find patterns
    return error
      .replace(/\d+/g, 'N')  // Replace numbers
      .replace(/"[^"]+"/g, '"..."')  // Replace quoted strings
      .replace(/'.+'/g, "'...'")  // Replace single-quoted strings
      .slice(0, 100);  // Truncate
  }

  private analyzeUserFriction(signals: FeedbackSignalData[]): AnalysisResult['userFrictionPoints'] {
    const corrections: string[] = [];
    const complaints: string[] = [];

    for (const signal of signals) {
      const data = signal.signal_data as { userMessage?: string } | null;
      if (signal.signal_type === SignalType.USER_CORRECTION && data?.userMessage) {
        corrections.push(data.userMessage.slice(0, 100));
      }
      if (signal.signal_type === SignalType.USER_COMPLAINT && data?.userMessage) {
        complaints.push(data.userMessage.slice(0, 100));
      }
    }

    const result: AnalysisResult['userFrictionPoints'] = [];
    if (corrections.length > 0) {
      result.push({ type: 'correction', count: corrections.length, samples: corrections.slice(0, 3) });
    }
    if (complaints.length > 0) {
      result.push({ type: 'complaint', count: complaints.length, samples: complaints.slice(0, 3) });
    }
    return result;
  }

  private calculateHealth(executions: ToolExecutionData[], signals: FeedbackSignalData[]): AnalysisResult['overallHealth'] {
    const total = executions.length;
    const successes = executions.filter(e => e.status === ToolExecutionStatus.SUCCESS).length;
    const toolSuccessRate = total > 0 ? successes / total : 1.0;

    const complaints = signals.filter(s => s.signal_type === SignalType.USER_COMPLAINT).length;
    const corrections = signals.filter(s => s.signal_type === SignalType.USER_CORRECTION).length;
    const frictionCount = complaints + corrections;
    const userSatisfactionScore = Math.max(0, 1 - (frictionCount * 0.1));

    const improvementNeeded = toolSuccessRate < 0.8 || userSatisfactionScore < 0.7 || frictionCount > 5;

    return {
      toolSuccessRate,
      userSatisfactionScore,
      signalCount: signals.length,
      improvementNeeded,
    };
  }

  private generateRecommendations(
    failingTools: AnalysisResult['failingTools'],
    errorPatterns: AnalysisResult['errorPatterns'],
    friction: AnalysisResult['userFrictionPoints']
  ): AnalysisResult['recommendations'] {
    const recommendations: AnalysisResult['recommendations'] = [];

    // High priority: Failing tools
    for (const tool of failingTools.slice(0, 3)) {
      if (tool.failureRate > 0.5) {
        recommendations.push({
          priority: 'high',
          type: 'tool_fix',
          description: `Tool '${tool.toolName}' has ${Math.round(tool.failureRate * 100)}% failure rate. Common errors: ${tool.commonErrors.slice(0, 2).join('; ')}`,
          targetFile: `execution/${tool.toolName}.py`,
        });
      }
    }

    // Medium priority: Error patterns
    for (const pattern of errorPatterns.slice(0, 2)) {
      recommendations.push({
        priority: 'medium',
        type: 'directive_update',
        description: `Error pattern "${pattern.pattern}" occurred ${pattern.occurrences} times in tools: ${pattern.affectedTools.join(', ')}`,
      });
    }

    // Medium priority: User friction
    for (const fp of friction) {
      if (fp.count > 3) {
        recommendations.push({
          priority: fp.type === 'complaint' ? 'high' : 'medium',
          type: 'directive_update',
          description: `${fp.count} user ${fp.type}s detected. Sample: "${fp.samples[0]}"`,
        });
      }
    }

    return recommendations;
  }

  /**
   * Update performance baseline for a tenant
   */
  async updateBaseline(tenantId: string, windowHours: number = 24): Promise<void> {
    const analysis = await this.analyze(tenantId, windowHours);

    await this.prisma.performance_baselines.upsert({
      where: { tenant_id: tenantId },
      create: {
        tenant_id: tenantId,
        tool_success_rate: analysis.overallHealth.toolSuccessRate,
        user_satisfaction_score: analysis.overallHealth.userSatisfactionScore,
        tool_metrics: { failingTools: analysis.failingTools },
      },
      update: {
        tool_success_rate: analysis.overallHealth.toolSuccessRate,
        user_satisfaction_score: analysis.overallHealth.userSatisfactionScore,
        tool_metrics: { failingTools: analysis.failingTools },
      },
    });

    logger.info({ tenantId, successRate: analysis.overallHealth.toolSuccessRate }, 'Performance baseline updated');
  }
}
