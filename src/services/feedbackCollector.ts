import { PrismaClient, SignalType, Prisma } from '@prisma/client';
import { logger } from '../utils/logger.js';

export class FeedbackCollector {
  constructor(private prisma: PrismaClient) {}

  /**
   * Record a feedback signal
   */
  async recordSignal(
    tenantId: string,
    sessionId: string,
    signalType: SignalType,
    signalData: Record<string, unknown>,
    severity: 'info' | 'warning' | 'error' | 'critical' = 'info',
    toolExecutionId?: string
  ): Promise<string> {
    const signal = await this.prisma.feedback_signals.create({
      data: {
        tenant_id: tenantId,
        session_id: sessionId,
        signal_type: signalType,
        signal_data: signalData as Prisma.InputJsonValue,
        severity,
        tool_execution_id: toolExecutionId,
      },
    });

    logger.info({ tenantId, signalType, severity }, 'Feedback signal recorded');
    return signal.id;
  }

  /**
   * Detect user correction patterns in message
   */
  detectCorrection(message: string): boolean {
    const patterns = [
      /\bno\b.*\b(wrong|not|incorrect)\b/i,
      /\bnot what i\b/i,
      /\bi (said|meant|asked for)\b/i,
      /\bactually\b.*\bi want\b/i,
      /\bthat'?s not (right|correct)\b/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Detect user complaint patterns in message
   */
  detectComplaint(message: string): boolean {
    const patterns = [
      /\byou (keep|always|never)\b/i,
      /\bwhy (can'?t|won'?t|don'?t)\b/i,
      /\bfrustrat/i,
      /\buseless\b/i,
      /\bdoesn'?t work\b/i,
      /\bstop (doing|saying)\b/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Analyze a user message for feedback signals
   */
  async analyzeUserMessage(
    tenantId: string,
    sessionId: string,
    userMessage: string
  ): Promise<void> {
    if (this.detectCorrection(userMessage)) {
      await this.recordSignal(
        tenantId,
        sessionId,
        'USER_CORRECTION',
        { userMessage },
        'warning'
      );
    }

    if (this.detectComplaint(userMessage)) {
      await this.recordSignal(
        tenantId,
        sessionId,
        'USER_COMPLAINT',
        { userMessage },
        'error'
      );
    }
  }

  /**
   * Record tool failure signal
   */
  async recordToolFailure(
    tenantId: string,
    sessionId: string,
    toolExecutionId: string,
    toolName: string,
    errorMessage: string
  ): Promise<void> {
    await this.recordSignal(
      tenantId,
      sessionId,
      'TOOL_FAILURE',
      { toolName, errorMessage },
      'error',
      toolExecutionId
    );
  }

  /**
   * Record guard triggered signal
   */
  async recordGuardTriggered(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    guardedResponse: string
  ): Promise<void> {
    await this.recordSignal(
      tenantId,
      sessionId,
      'GUARD_TRIGGERED',
      { userMessage, guardedResponse },
      'warning'
    );
  }

  /**
   * Get unprocessed signals for a tenant
   */
  async getUnprocessedSignals(tenantId: string): Promise<Array<{
    id: string;
    signalType: SignalType;
    signalData: unknown;
    severity: string;
    createdAt: Date;
  }>> {
    return this.prisma.feedback_signals.findMany({
      where: {
        tenant_id: tenantId,
        processed: false,
      },
      select: {
        id: true,
        signal_type: true,
        signal_data: true,
        severity: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    }).then(signals => signals.map(s => ({
      id: s.id,
      signalType: s.signal_type,
      signalData: s.signal_data,
      severity: s.severity,
      createdAt: s.created_at,
    })));
  }

  /**
   * Mark signals as processed
   */
  async markProcessed(signalIds: string[], improvementId: string): Promise<void> {
    await this.prisma.feedback_signals.updateMany({
      where: { id: { in: signalIds } },
      data: {
        processed: true,
        improvement_id: improvementId,
      },
    });
  }

  /**
   * Get signal counts by type for a tenant
   */
  async getSignalCounts(tenantId: string, windowHours: number = 24): Promise<Record<string, number>> {
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const signals = await this.prisma.feedback_signals.groupBy({
      by: ['signal_type'],
      where: {
        tenant_id: tenantId,
        created_at: { gte: cutoff },
      },
      _count: true,
    });

    return signals.reduce((acc, s) => {
      acc[s.signal_type] = s._count;
      return acc;
    }, {} as Record<string, number>);
  }
}
