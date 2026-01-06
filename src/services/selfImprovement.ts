import { PrismaClient } from '@prisma/client';
import { PatternAnalyzer, AnalysisResult } from './patternAnalyzer.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface ImprovementProposal {
  type: 'directive_update' | 'tool_config' | 'none';
  targetFile: string;
  patternAddressed: string;
  changes: {
    description: string;
    appendContent?: string;  // Content to append to directive
    replaceContent?: { old: string; new: string };
  };
  expectedImpact: string;
}

export class SelfImprovementService {
  private projectRoot: string;
  
  constructor(
    private prisma: PrismaClient,
    private patternAnalyzer: PatternAnalyzer,
    projectRoot?: string
  ) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Run improvement cycle for a tenant
   */
  async runImprovementCycle(tenantId: string): Promise<{ improved: boolean; improvementId?: string }> {
    logger.info({ tenantId }, 'Starting improvement cycle');
    
    // 1. Check rate limit (max 3 improvements per 24h)
    const recentImprovements = await this.getRecentImprovements(tenantId, 24);
    if (recentImprovements.length >= 3) {
      logger.warn({ tenantId, count: recentImprovements.length }, 'Rate limit reached, skipping improvement');
      return { improved: false };
    }
    
    // 2. Run analysis
    const analysis = await this.patternAnalyzer.analyze(tenantId);
    
    // 3. Check if improvement needed
    if (!analysis.overallHealth.improvementNeeded || analysis.recommendations.length === 0) {
      logger.info({ tenantId }, 'No improvement needed');
      return { improved: false };
    }
    
    // 4. Generate improvement proposal
    const proposal = this.generateProposal(tenantId, analysis);
    if (proposal.type === 'none') {
      logger.info({ tenantId }, 'No actionable improvement proposal');
      return { improved: false };
    }
    
    // 5. Apply improvement with backup
    const tenantFolder = path.join(this.projectRoot, 'tenants', tenantId);
    const targetPath = path.join(tenantFolder, proposal.targetFile);
    
    let beforeState: string | null = null;
    try {
      beforeState = await fs.promises.readFile(targetPath, 'utf-8');
    } catch {
      // File doesn't exist, that's ok for new directives
    }
    
    await this.applyImprovement(tenantFolder, proposal);
    
    let afterState: string | null = null;
    try {
      afterState = await fs.promises.readFile(targetPath, 'utf-8');
    } catch {
      // Shouldn't happen after apply
    }
    
    // 6. Log improvement
    const improvementLog = await this.prisma.improvement_logs.create({
      data: {
        tenant_id: tenantId,
        trigger_type: 'threshold',
        trigger_signals: [],
        analysis_summary: JSON.stringify({
          successRate: analysis.overallHealth.toolSuccessRate,
          recommendations: analysis.recommendations.length,
        }),
        pattern_identified: proposal.patternAddressed,
        action_type: proposal.type,
        action_details: proposal.changes,
        before_state: beforeState ?? null,
        after_state: afterState ?? null,
        verification_status: 'pending',
      },
    });
    
    logger.info({ tenantId, improvementId: improvementLog.id, type: proposal.type }, 'Improvement applied');
    
    // 7. Update baseline
    await this.patternAnalyzer.updateBaseline(tenantId);
    
    return { improved: true, improvementId: improvementLog.id };
  }

  /**
   * Generate improvement proposal from analysis
   */
  private generateProposal(tenantId: string, analysis: AnalysisResult): ImprovementProposal {
    // Take highest priority recommendation
    const rec = analysis.recommendations[0];
    if (!rec) {
      return { type: 'none', targetFile: '', patternAddressed: '', changes: { description: '' }, expectedImpact: '' };
    }
    
    if (rec.type === 'directive_update') {
      // Generate directive improvement
      const appendContent = this.generateDirectiveImprovement(rec, analysis);
      return {
        type: 'directive_update',
        targetFile: rec.targetFile || 'directives/improvements.md',
        patternAddressed: rec.description,
        changes: {
          description: `Add guidance for: ${rec.description}`,
          appendContent,
        },
        expectedImpact: 'Reduce errors by providing clearer instructions',
      };
    }
    
    if (rec.type === 'tool_fix' && rec.targetFile) {
      // For tool fixes, we document the issue in a directive (safer than modifying code)
      return {
        type: 'directive_update',
        targetFile: 'directives/tool_issues.md',
        patternAddressed: rec.description,
        changes: {
          description: `Document known issue with ${rec.targetFile}`,
          appendContent: `\n\n## Known Issue: ${rec.targetFile}\n\n${rec.description}\n\n**Workaround**: Check input carefully before calling this tool.\n`,
        },
        expectedImpact: 'Help user avoid known tool issues',
      };
    }
    
    return { type: 'none', targetFile: '', patternAddressed: '', changes: { description: '' }, expectedImpact: '' };
  }

  /**
   * Generate directive improvement content
   */
  private generateDirectiveImprovement(rec: AnalysisResult['recommendations'][0], analysis: AnalysisResult): string {
    const lines: string[] = [];
    
    if (rec.priority === 'high') {
      lines.push(`\n\n## Important: ${rec.description.slice(0, 50)}...\n`);
    } else {
      lines.push(`\n\n## Note: ${rec.description.slice(0, 50)}...\n`);
    }
    
    lines.push(`*Auto-generated improvement based on ${analysis.overallHealth.signalCount} signals*\n`);
    lines.push(`\n${rec.description}\n`);
    
    // Add specific guidance based on friction type
    for (const fp of analysis.userFrictionPoints) {
      if (fp.type === 'correction' && fp.count > 2) {
        lines.push(`\n**User Clarification Needed**: Users frequently correct responses. Before acting, confirm understanding.\n`);
      }
      if (fp.type === 'complaint' && fp.count > 2) {
        lines.push(`\n**Caution**: Users have expressed frustration. Be extra careful and ask before proceeding.\n`);
      }
    }
    
    return lines.join('');
  }

  /**
   * Apply improvement to tenant folder
   */
  private async applyImprovement(tenantFolder: string, proposal: ImprovementProposal): Promise<void> {
    const targetPath = path.join(tenantFolder, proposal.targetFile);
    const targetDir = path.dirname(targetPath);
    
    // Ensure directory exists
    await fs.promises.mkdir(targetDir, { recursive: true });
    
    if (proposal.changes.appendContent) {
      // Append to file (create if doesn't exist)
      let existing = '';
      try {
        existing = await fs.promises.readFile(targetPath, 'utf-8');
      } catch {
        // File doesn't exist, create with header
        existing = `# Auto-Generated Improvements\n\nThis file contains automatically generated guidance based on usage patterns.\n`;
      }
      
      await fs.promises.writeFile(targetPath, existing + proposal.changes.appendContent, 'utf-8');
    }
    
    if (proposal.changes.replaceContent) {
      const content = await fs.promises.readFile(targetPath, 'utf-8');
      const newContent = content.replace(
        proposal.changes.replaceContent.old,
        proposal.changes.replaceContent.new
      );
      await fs.promises.writeFile(targetPath, newContent, 'utf-8');
    }
  }

  /**
   * Get recent improvements for rate limiting
   */
  private async getRecentImprovements(tenantId: string, hours: number) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.prisma.improvement_logs.findMany({
      where: { tenant_id: tenantId, created_at: { gte: cutoff } },
      select: { id: true },
    });
  }

  /**
   * Verify an improvement (called 4 hours after application)
   */
  async verifyImprovement(improvementId: string): Promise<'improved' | 'neutral' | 'degraded'> {
    const improvement = await this.prisma.improvement_logs.findUnique({
      where: { id: improvementId },
    });

    if (!improvement) {
      throw new Error(`Improvement ${improvementId} not found`);
    }

    // Get current metrics
    const currentAnalysis = await this.patternAnalyzer.analyze(improvement.tenant_id, 4);
    const beforeState = improvement.before_state;

    // Compare (simplified - just check if success rate improved)
    const baseline = await this.prisma.performance_baselines.findUnique({
      where: { tenant_id: improvement.tenant_id },
    });

    let status: 'improved' | 'neutral' | 'degraded' = 'neutral';
    if (baseline) {
      const diff = currentAnalysis.overallHealth.toolSuccessRate - baseline.tool_success_rate;
      if (diff > 0.05) status = 'improved';
      else if (diff < -0.1) status = 'degraded';
    }

    // Update improvement log
    await this.prisma.improvement_logs.update({
      where: { id: improvementId },
      data: {
        verification_status: status,
        verified_at: new Date(),
      },
    });

    // Rollback if degraded
    if (status === 'degraded' && beforeState) {
      await this.rollback(improvement.tenant_id, improvement, beforeState);
    }

    return status;
  }

  /**
   * Rollback an improvement
   */
  private async rollback(tenantId: string, improvement: { id: string; action_details: unknown }, previousContent: string): Promise<void> {
    const actionDetails = improvement.action_details as { targetFile?: string } | null;
    const targetFile = actionDetails?.targetFile;
    if (!targetFile) {
      logger.warn({ tenantId, improvementId: improvement.id }, 'No target file in action_details, cannot rollback');
      return;
    }

    const targetPath = path.join(this.projectRoot, 'tenants', tenantId, targetFile);

    try {
      await fs.promises.writeFile(targetPath, previousContent, 'utf-8');
      await this.prisma.improvement_logs.update({
        where: { id: improvement.id },
        data: { rolled_back: true },
      });
      logger.info({ tenantId, improvementId: improvement.id }, 'Improvement rolled back');
    } catch (error) {
      logger.error({ tenantId, improvementId: improvement.id, error }, 'Failed to rollback improvement');
    }
  }
}
