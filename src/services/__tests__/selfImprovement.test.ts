/**
 * SelfImprovementService Tests
 */

import { SelfImprovementService } from '../selfImprovement.js';
import { PatternAnalyzer, AnalysisResult } from '../patternAnalyzer.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock fs
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

describe('SelfImprovementService', () => {
  let mockPrisma: any;
  let mockPatternAnalyzer: jest.Mocked<PatternAnalyzer>;
  let service: SelfImprovementService;

  const baseAnalysisResult: AnalysisResult = {
    overallHealth: {
      toolSuccessRate: 0.95,
      signalCount: 5,
      improvementNeeded: false,
    },
    failingTools: [],
    userFrictionPoints: [],
    recommendations: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      improvement_logs: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'improvement-1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      performance_baselines: {
        findUnique: jest.fn(),
      },
    };

    mockPatternAnalyzer = {
      analyze: jest.fn().mockResolvedValue(baseAnalysisResult),
      updateBaseline: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new SelfImprovementService(
      mockPrisma,
      mockPatternAnalyzer,
      '/test/project'
    );
  });

  describe('runImprovementCycle', () => {
    it('skips when rate limit reached (3 improvements in 24h)', async () => {
      mockPrisma.improvement_logs.findMany.mockResolvedValue([
        { id: 'imp-1' },
        { id: 'imp-2' },
        { id: 'imp-3' },
      ]);

      const result = await service.runImprovementCycle('tenant-1');

      expect(result).toEqual({ improved: false });
      expect(mockPatternAnalyzer.analyze).not.toHaveBeenCalled();
    });

    it('skips when no improvement needed', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: false },
      });

      const result = await service.runImprovementCycle('tenant-1');

      expect(result).toEqual({ improved: false });
    });

    it('skips when no recommendations', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: true },
        recommendations: [],
      });

      const result = await service.runImprovementCycle('tenant-1');

      expect(result).toEqual({ improved: false });
    });

    it('applies directive update improvement', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: true },
        recommendations: [{
          type: 'directive_update',
          description: 'Add error handling guidance',
          priority: 'high',
          targetFile: 'directives/error_handling.md',
        }],
        userFrictionPoints: [],
      });

      (fs.promises.readFile as jest.Mock).mockResolvedValue('# Existing content');
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      const result = await service.runImprovementCycle('tenant-1');

      expect(result.improved).toBe(true);
      expect(result.improvementId).toBe('improvement-1');
      expect(mockPrisma.improvement_logs.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          action_type: 'directive_update',
          verification_status: 'pending',
        }),
      });
    });

    it('handles tool_fix by creating documentation', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: true },
        recommendations: [{
          type: 'tool_fix',
          description: 'send_email times out frequently',
          priority: 'high',
          targetFile: 'execution/send_email.py',
        }],
        userFrictionPoints: [],
      });

      (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      const result = await service.runImprovementCycle('tenant-1');

      expect(result.improved).toBe(true);
      // Should create a directive documenting the tool issue
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('tool_issues.md'),
        expect.stringContaining('send_email'),
        'utf-8'
      );
    });

    it('updates baseline after improvement', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: true },
        recommendations: [{
          type: 'directive_update',
          description: 'Test improvement',
          priority: 'medium',
        }],
        userFrictionPoints: [],
      });

      (fs.promises.readFile as jest.Mock).mockResolvedValue('');
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      await service.runImprovementCycle('tenant-1');

      expect(mockPatternAnalyzer.updateBaseline).toHaveBeenCalledWith('tenant-1');
    });

    it('adds user friction guidance when correction count > 2', async () => {
      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { ...baseAnalysisResult.overallHealth, improvementNeeded: true },
        recommendations: [{
          type: 'directive_update',
          description: 'Users need clarification',
          priority: 'high',
        }],
        userFrictionPoints: [{ type: 'correction', count: 5 }],
      });

      (fs.promises.readFile as jest.Mock).mockResolvedValue('');
      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.promises.mkdir as jest.Mock).mockResolvedValue(undefined);

      await service.runImprovementCycle('tenant-1');

      const writeCall = (fs.promises.writeFile as jest.Mock).mock.calls[0];
      expect(writeCall[1]).toContain('User Clarification Needed');
    });
  });

  describe('verifyImprovement', () => {
    it('throws when improvement not found', async () => {
      mockPrisma.improvement_logs.findUnique.mockResolvedValue(null);

      await expect(service.verifyImprovement('nonexistent'))
        .rejects.toThrow('Improvement nonexistent not found');
    });

    it('returns improved when success rate increased', async () => {
      mockPrisma.improvement_logs.findUnique.mockResolvedValue({
        id: 'imp-1',
        tenant_id: 'tenant-1',
        before_state: 'old content',
      });

      mockPrisma.performance_baselines.findUnique.mockResolvedValue({
        tool_success_rate: 0.80,
      });

      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { toolSuccessRate: 0.90, signalCount: 3, improvementNeeded: false },
      });

      const status = await service.verifyImprovement('imp-1');

      expect(status).toBe('improved');
      expect(mockPrisma.improvement_logs.update).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        data: expect.objectContaining({
          verification_status: 'improved',
          verified_at: expect.any(Date),
        }),
      });
    });

    it('returns degraded and rolls back when success rate dropped significantly', async () => {
      mockPrisma.improvement_logs.findUnique.mockResolvedValue({
        id: 'imp-1',
        tenant_id: 'tenant-1',
        before_state: 'original content',
        action_details: { targetFile: 'directives/test.md' },
      });

      mockPrisma.performance_baselines.findUnique.mockResolvedValue({
        tool_success_rate: 0.90,
      });

      mockPatternAnalyzer.analyze.mockResolvedValue({
        ...baseAnalysisResult,
        overallHealth: { toolSuccessRate: 0.75, signalCount: 10, improvementNeeded: true },
      });

      (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

      const status = await service.verifyImprovement('imp-1');

      expect(status).toBe('degraded');
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.md'),
        'original content',
        'utf-8'
      );
      expect(mockPrisma.improvement_logs.update).toHaveBeenCalledWith({
        where: { id: 'imp-1' },
        data: expect.objectContaining({ rolled_back: true }),
      });
    });

    it('returns neutral when no baseline', async () => {
      mockPrisma.improvement_logs.findUnique.mockResolvedValue({
        id: 'imp-1',
        tenant_id: 'tenant-1',
      });

      mockPrisma.performance_baselines.findUnique.mockResolvedValue(null);

      mockPatternAnalyzer.analyze.mockResolvedValue(baseAnalysisResult);

      const status = await service.verifyImprovement('imp-1');

      expect(status).toBe('neutral');
    });
  });
});
