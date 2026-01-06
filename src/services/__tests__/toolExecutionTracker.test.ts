/**
 * ToolExecutionTracker Service Tests
 */

import { ToolExecutionTracker } from '../toolExecutionTracker.js';

describe('ToolExecutionTracker', () => {
  let mockPrisma: any;
  let tracker: ToolExecutionTracker;

  beforeEach(() => {
    mockPrisma = {
      tool_executions: {
        create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    tracker = new ToolExecutionTracker(mockPrisma);
  });

  describe('startExecution', () => {
    it('creates execution record with all fields', async () => {
      const execId = await tracker.startExecution(
        'tenant-1',
        'session-1',
        'send_email',
        'tenant',
        { to: 'test@example.com' },
        'email_directive.md'
      );

      expect(execId).toBe('exec-1');
      expect(mockPrisma.tool_executions.create).toHaveBeenCalledWith({
        data: {
          tenant_id: 'tenant-1',
          session_id: 'session-1',
          tool_name: 'send_email',
          tool_type: 'tenant',
          input_payload: { to: 'test@example.com' },
          status: 'PENDING',
          directive_used: 'email_directive.md',
        },
      });
    });

    it('handles null session_id', async () => {
      await tracker.startExecution(
        'tenant-1',
        null,
        'get_time',
        'shared',
        {}
      );

      expect(mockPrisma.tool_executions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          session_id: null,
        }),
      });
    });

    it('handles missing directive_used', async () => {
      await tracker.startExecution(
        'tenant-1',
        'session-1',
        'search_web',
        'shared',
        { query: 'test' }
      );

      expect(mockPrisma.tool_executions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          directive_used: undefined,
        }),
      });
    });
  });

  describe('completeExecution', () => {
    it('updates execution with success', async () => {
      await tracker.completeExecution(
        'exec-1',
        'SUCCESS',
        { result: 'email sent' },
        1500
      );

      expect(mockPrisma.tool_executions.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: {
          status: 'SUCCESS',
          output_payload: { result: 'email sent' },
          duration_ms: 1500,
          error_message: undefined,
          completed_at: expect.any(Date),
        },
      });
    });

    it('updates execution with failure and error message', async () => {
      await tracker.completeExecution(
        'exec-1',
        'FAILURE',
        null,
        500,
        'Connection refused'
      );

      expect(mockPrisma.tool_executions.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: expect.objectContaining({
          status: 'FAILURE',
          error_message: 'Connection refused',
        }),
      });
    });

    it('updates execution with timeout', async () => {
      await tracker.completeExecution(
        'exec-1',
        'TIMEOUT',
        null,
        30000,
        'Tool execution timed out after 30s'
      );

      expect(mockPrisma.tool_executions.update).toHaveBeenCalledWith({
        where: { id: 'exec-1' },
        data: expect.objectContaining({
          status: 'TIMEOUT',
        }),
      });
    });
  });

  describe('getStats', () => {
    it('calculates stats correctly with executions', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { status: 'SUCCESS', duration_ms: 1000 },
        { status: 'SUCCESS', duration_ms: 2000 },
        { status: 'FAILURE', duration_ms: 500 },
        { status: 'SUCCESS', duration_ms: 1500 },
      ]);

      const stats = await tracker.getStats('tenant-1', 24);

      expect(stats).toEqual({
        total: 4,
        success: 3,
        failure: 1,
        successRate: 0.75,
        avgDurationMs: 1250,
      });
    });

    it('returns default stats when no executions', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([]);

      const stats = await tracker.getStats('tenant-1');

      expect(stats).toEqual({
        total: 0,
        success: 0,
        failure: 0,
        successRate: 1.0,
        avgDurationMs: 0,
      });
    });

    it('handles null duration_ms values', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { status: 'SUCCESS', duration_ms: 1000 },
        { status: 'SUCCESS', duration_ms: null },
      ]);

      const stats = await tracker.getStats('tenant-1');

      expect(stats.avgDurationMs).toBe(500); // (1000 + 0) / 2
    });

    it('uses window hours for filtering', async () => {
      await tracker.getStats('tenant-1', 48);

      expect(mockPrisma.tool_executions.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          started_at: { gte: expect.any(Date) },
          status: { not: 'PENDING' },
        },
        select: { status: true, duration_ms: true },
      });
    });
  });

  describe('getFailingTools', () => {
    it('returns tools with high failure rates', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { tool_name: 'send_email', status: 'SUCCESS', error_message: null },
        { tool_name: 'send_email', status: 'FAILURE', error_message: 'SMTP error' },
        { tool_name: 'send_email', status: 'FAILURE', error_message: 'Timeout' },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
      ]);

      const failingTools = await tracker.getFailingTools('tenant-1', 24);

      expect(failingTools).toEqual([{
        toolName: 'send_email',
        failureCount: 2,
        failureRate: 2/3,
        recentErrors: ['SMTP error', 'Timeout'],
      }]);
    });

    it('excludes tools with less than 10% failure rate', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'SUCCESS', error_message: null },
        { tool_name: 'search_web', status: 'FAILURE', error_message: 'error' }, // 10% exactly
      ]);

      const failingTools = await tracker.getFailingTools('tenant-1');

      expect(failingTools).toEqual([]);
    });

    it('limits recent errors to 5', async () => {
      const executions = [];
      for (let i = 0; i < 10; i++) {
        executions.push({ tool_name: 'bad_tool', status: 'FAILURE', error_message: `Error ${i}` });
      }
      mockPrisma.tool_executions.findMany.mockResolvedValue(executions);

      const failingTools = await tracker.getFailingTools('tenant-1');

      expect(failingTools[0].recentErrors).toHaveLength(5);
    });

    it('sorts by failure rate descending', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { tool_name: 'tool_a', status: 'SUCCESS', error_message: null },
        { tool_name: 'tool_a', status: 'FAILURE', error_message: 'err' }, // 50%
        { tool_name: 'tool_b', status: 'FAILURE', error_message: 'err' },
        { tool_name: 'tool_b', status: 'FAILURE', error_message: 'err' },
        { tool_name: 'tool_b', status: 'SUCCESS', error_message: null }, // 66%
      ]);

      const failingTools = await tracker.getFailingTools('tenant-1');

      expect(failingTools[0].toolName).toBe('tool_b');
      expect(failingTools[1].toolName).toBe('tool_a');
    });

    it('includes TIMEOUT as failure', async () => {
      mockPrisma.tool_executions.findMany.mockResolvedValue([
        { tool_name: 'slow_tool', status: 'TIMEOUT', error_message: 'Timed out' },
        { tool_name: 'slow_tool', status: 'TIMEOUT', error_message: 'Timed out' },
        { tool_name: 'slow_tool', status: 'SUCCESS', error_message: null },
      ]);

      const failingTools = await tracker.getFailingTools('tenant-1');

      expect(failingTools[0].failureCount).toBe(2);
    });
  });
});
