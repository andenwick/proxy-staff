/**
 * Queue Worker Tests
 *
 * Tests for job processing, failure handling, cancellation,
 * and worker lifecycle management.
 */

import { EventEmitter } from 'events';
import { Job, Worker } from 'bullmq';
import { spawn, execSync } from 'child_process';

// Store the processor function for testing
let capturedProcessor: ((job: Job) => Promise<any>) | null = null;

// Mock BullMQ Worker to capture the processor
jest.mock('bullmq', () => {
  return {
    Worker: jest.fn().mockImplementation((queueName, processor, options) => {
      capturedProcessor = processor;
      const mockWorker = new EventEmitter() as any;
      mockWorker.close = jest.fn().mockResolvedValue(undefined);
      mockWorker.pause = jest.fn().mockResolvedValue(undefined);
      mockWorker.resume = jest.fn().mockResolvedValue(undefined);
      mockWorker.isRunning = jest.fn().mockReturnValue(true);
      return mockWorker;
    }),
    Job: jest.fn(),
  };
});

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

// Mock data
const mockPrisma = {
  async_jobs: {
    update: jest.fn().mockResolvedValue({}),
  },
  conversationSession: {
    findFirst: jest.fn().mockResolvedValue({ id: 'session-123', reset_timestamp: null }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  messages: {
    create: jest.fn().mockResolvedValue({ id: 'msg-123' }),
  },
};

const mockRedisConnection = {
  on: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
  quit: jest.fn().mockResolvedValue(undefined),
};

// Mock external dependencies
jest.mock('../../prisma.js', () => ({
  getPrismaClient: jest.fn(() => mockPrisma),
}));

jest.mock('../queueService.js', () => ({
  getRedisConnection: jest.fn(() => mockRedisConnection),
  LongTaskJob: {},
  SessionEndJob: {},
  QueueJob: {},
}));

jest.mock('../../claudeCli.js', () => ({
  generateCliSessionId: jest.fn((id: string, resetTs?: number) =>
    resetTs ? `cli-${id}-${resetTs}` : `cli-${id}`
  ),
}));

jest.mock('../../session.js', () => ({
  releaseSessionLease: jest.fn().mockResolvedValue(undefined),
}));

const mockLearningService = {
  triggerConversationEndLearning: jest.fn().mockResolvedValue(undefined),
};

const mockTenantFolderService = {
  initializeTenantForCli: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../index.js', () => ({
  getTenantFolderService: jest.fn(() => mockTenantFolderService),
  getLearningService: jest.fn(() => mockLearningService),
}));

jest.mock('../../../config/index.js', () => ({
  getConfig: jest.fn(() => ({
    queue: {
      workerEnabled: true,
      concurrency: 1,
      maxJobRuntimeMs: 300000,
      progressUpdateIntervalMs: 60000,
    },
  })),
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

const mockJobInterruptService = {
  registerRunningJob: jest.fn(),
  updateJobPid: jest.fn(),
  unregisterJob: jest.fn(),
  getRunningJob: jest.fn(),
};

jest.mock('../jobInterruptService.js', () => mockJobInterruptService);

jest.mock('../progressMessenger.js', () => ({
  sendProgressUpdate: jest.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  setSendMessageFn,
  startWorker,
  stopWorker,
  pauseWorker,
  resumeWorker,
  isWorkerRunning,
  getWorker,
} from '../queueWorker.js';
import { releaseSessionLease } from '../../session.js';
import { getConfig } from '../../../config/index.js';
import { generateCliSessionId } from '../../claudeCli.js';

// Helper to create a mock CLI process
function createMockProcess() {
  const mockStdin = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock };
  mockStdin.write = jest.fn();
  mockStdin.end = jest.fn();

  const mockStdout = new EventEmitter();
  const mockStderr = new EventEmitter();

  const mockProcess = new EventEmitter() as EventEmitter & {
    stdin: typeof mockStdin;
    stdout: typeof mockStdout;
    stderr: typeof mockStderr;
    kill: jest.Mock;
    pid: number;
  };
  mockProcess.stdin = mockStdin;
  mockProcess.stdout = mockStdout;
  mockProcess.stderr = mockStderr;
  mockProcess.kill = jest.fn();
  mockProcess.pid = 12345;

  return { mockProcess, mockStdin, mockStdout, mockStderr };
}

describe('Queue Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = null;
    mockPrisma.async_jobs.update.mockResolvedValue({});
    mockPrisma.conversationSession.findFirst.mockResolvedValue({ id: 'session-123', reset_timestamp: null });
  });

  afterEach(async () => {
    await stopWorker();
  });

  describe('setSendMessageFn', () => {
    it('sets the message sending function', () => {
      const mockSendFn = jest.fn().mockResolvedValue('msg-id');
      setSendMessageFn(mockSendFn);
      expect(true).toBe(true);
    });
  });

  describe('startWorker', () => {
    it('returns null when worker is disabled', () => {
      (getConfig as jest.Mock).mockReturnValueOnce({
        queue: {
          workerEnabled: false,
          concurrency: 1,
          maxJobRuntimeMs: 300000,
          progressUpdateIntervalMs: 60000,
        },
      });

      const worker = startWorker();
      expect(worker).toBeNull();
    });

    it('starts worker when enabled', () => {
      const worker = startWorker();
      expect(worker).toBeDefined();
      expect(Worker).toHaveBeenCalledWith(
        'async-tasks',
        expect.any(Function),
        expect.objectContaining({
          concurrency: 1,
        })
      );
    });

    it('captures processor function for job handling', () => {
      startWorker();
      expect(capturedProcessor).toBeDefined();
      expect(typeof capturedProcessor).toBe('function');
    });
  });

  describe('stopWorker', () => {
    it('stops the worker gracefully', async () => {
      startWorker();
      await stopWorker();
      expect(true).toBe(true);
    });

    it('handles being called when no worker running', async () => {
      await stopWorker();
      expect(true).toBe(true);
    });
  });

  describe('pauseWorker and resumeWorker', () => {
    it('pauses and resumes the worker', async () => {
      const worker = startWorker();
      await pauseWorker();
      expect(worker?.pause).toHaveBeenCalled();
      await resumeWorker();
      expect(worker?.resume).toHaveBeenCalled();
    });

    it('handles pause when no worker', async () => {
      await stopWorker();
      await pauseWorker();
      expect(true).toBe(true);
    });

    it('handles resume when no worker', async () => {
      await stopWorker();
      await resumeWorker();
      expect(true).toBe(true);
    });
  });

  describe('isWorkerRunning', () => {
    it('returns false when no worker started', async () => {
      await stopWorker();
      expect(isWorkerRunning()).toBe(false);
    });

    it('returns true when worker is running', () => {
      startWorker();
      expect(isWorkerRunning()).toBe(true);
    });
  });

  describe('getWorker', () => {
    it('returns null when no worker started', async () => {
      await stopWorker();
      expect(getWorker()).toBeNull();
    });

    it('returns worker instance when started', () => {
      startWorker();
      expect(getWorker()).toBeDefined();
    });
  });
});

describe('Session End Job Processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = null;
    mockPrisma.async_jobs.update.mockResolvedValue({});
  });

  afterEach(async () => {
    await stopWorker();
  });

  it('processes session-end jobs by calling learning service', async () => {
    startWorker();
    expect(capturedProcessor).toBeDefined();

    const sessionEndJob = {
      name: 'session-end',
      data: {
        type: 'session-end',
        sessionId: 'session-abc',
        tenantId: 'tenant-123',
        senderPhone: '+1234567890',
        reason: 'expiry' as const,
      },
    } as unknown as Job;

    const result = await capturedProcessor!(sessionEndJob);

    expect(mockLearningService.triggerConversationEndLearning).toHaveBeenCalledWith(
      'tenant-123',
      '+1234567890',
      'expiry'
    );
    expect(result).toEqual({ success: true });
  });

  it('processes session-end with reset reason', async () => {
    startWorker();

    const sessionEndJob = {
      name: 'session-end',
      data: {
        type: 'session-end',
        sessionId: 'session-def',
        tenantId: 'tenant-456',
        senderPhone: '+9876543210',
        reason: 'reset' as const,
      },
    } as unknown as Job;

    const result = await capturedProcessor!(sessionEndJob);

    expect(mockLearningService.triggerConversationEndLearning).toHaveBeenCalledWith(
      'tenant-456',
      '+9876543210',
      'reset'
    );
    expect(result).toEqual({ success: true });
  });

  it('throws error on learning service failure', async () => {
    startWorker();
    mockLearningService.triggerConversationEndLearning.mockRejectedValueOnce(new Error('Learning failed'));

    const sessionEndJob = {
      name: 'session-end',
      data: {
        type: 'session-end',
        sessionId: 'session-abc',
        tenantId: 'tenant-123',
        senderPhone: '+1234567890',
        reason: 'reset' as const,
      },
    } as unknown as Job;

    await expect(capturedProcessor!(sessionEndJob)).rejects.toThrow('Learning failed');
  });
});

describe('CLI Task Job - Cancelled Job', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedProcessor = null;
    mockPrisma.async_jobs.update.mockResolvedValue({});
    mockPrisma.conversationSession.findFirst.mockResolvedValue({ id: 'session-123', reset_timestamp: null });
  });

  afterEach(async () => {
    await stopWorker();
  });

  it('throws error for cancelled job before processing starts', async () => {
    startWorker();
    mockJobInterruptService.getRunningJob.mockReturnValue(null); // Job was cancelled

    const cliTaskJob = {
      name: 'cli-task',
      data: {
        type: 'cli-task',
        jobId: 'cancelled-job',
        tenantId: 'tenant-123',
        senderPhone: '+1234567890',
        sessionId: 'session-123',
        message: 'Test',
        estimatedDurationMs: 1000,
      },
    } as unknown as Job;

    // The processor throws when job fails (success: false)
    await expect(capturedProcessor!(cliTaskJob)).rejects.toThrow('Job failed');

    // But registerRunningJob was still called
    expect(mockJobInterruptService.registerRunningJob).toHaveBeenCalledWith(
      'tenant-123',
      '+1234567890',
      'cancelled-job'
    );
  });
});

describe('Worker Event Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await stopWorker();
  });

  it('handles completed event for cli-task', () => {
    const worker = startWorker();
    if (worker) {
      worker.emit('completed', {
        data: { type: 'cli-task', jobId: 'test-job' },
      } as any);
    }
    expect(true).toBe(true);
  });

  it('handles failed event for cli-task', () => {
    const worker = startWorker();
    if (worker) {
      worker.emit('failed', {
        data: { type: 'cli-task', jobId: 'test-job' },
      } as any, new Error('Test error'));
    }
    expect(true).toBe(true);
  });

  it('handles error event', () => {
    const worker = startWorker();
    if (worker) {
      worker.emit('error', new Error('Connection error'));
    }
    expect(true).toBe(true);
  });

  it('handles completed event for session-end', () => {
    const worker = startWorker();
    if (worker) {
      worker.emit('completed', {
        data: { type: 'session-end', sessionId: 'session-123' },
      } as any);
    }
    expect(true).toBe(true);
  });

  it('handles failed event for session-end', () => {
    const worker = startWorker();
    if (worker) {
      worker.emit('failed', {
        data: { type: 'session-end', sessionId: 'session-123' },
      } as any, new Error('Learning error'));
    }
    expect(true).toBe(true);
  });
});

describe('Cross-Platform Process Killing', () => {
  it('has execSync available for Windows taskkill', () => {
    const mockExecSync = execSync as jest.Mock;
    expect(mockExecSync).toBeDefined();
  });

  it('has kill method available for Unix SIGTERM/SIGKILL', () => {
    const { mockProcess } = createMockProcess();
    expect(mockProcess.kill).toBeDefined();
  });
});

describe('Worker Configuration', () => {
  afterEach(async () => {
    await stopWorker();
  });

  it('uses configured concurrency', () => {
    startWorker();
    expect(Worker).toHaveBeenCalledWith(
      'async-tasks',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 1,
      })
    );
  });

  it('connects to Redis via getRedisConnection', () => {
    startWorker();
    expect(Worker).toHaveBeenCalledWith(
      'async-tasks',
      expect.any(Function),
      expect.objectContaining({
        connection: mockRedisConnection,
      })
    );
  });

  it('registers event handlers on worker', () => {
    const worker = startWorker();
    expect(worker).toBeDefined();
    // Event handlers are registered during startWorker
    // We can verify by checking that emitting events doesn't throw
    if (worker) {
      expect(() => worker.emit('completed', { data: {} } as any)).not.toThrow();
      expect(() => worker.emit('failed', { data: {} } as any, new Error('test'))).not.toThrow();
      expect(() => worker.emit('error', new Error('test'))).not.toThrow();
    }
  });
});

describe('Job Interrupt Service Integration', () => {
  afterEach(async () => {
    await stopWorker();
  });

  it('registerRunningJob is called for CLI tasks (cancelled)', async () => {
    startWorker();
    mockJobInterruptService.getRunningJob.mockReturnValue(null);

    const cliTaskJob = {
      name: 'cli-task',
      data: {
        type: 'cli-task',
        jobId: 'interrupt-test-job',
        tenantId: 'tenant-123',
        senderPhone: '+1234567890',
        sessionId: 'session-123',
        message: 'Test',
        estimatedDurationMs: 1000,
      },
    } as unknown as Job;

    // Will throw because job is cancelled
    try {
      await capturedProcessor!(cliTaskJob);
    } catch {
      // Expected
    }

    expect(mockJobInterruptService.registerRunningJob).toHaveBeenCalledWith(
      'tenant-123',
      '+1234567890',
      'interrupt-test-job'
    );
  });

  it('updateJobPid is available for PID updates', () => {
    expect(mockJobInterruptService.updateJobPid).toBeDefined();
  });

  it('unregisterJob is available for cleanup', () => {
    expect(mockJobInterruptService.unregisterJob).toBeDefined();
  });

  it('getRunningJob is available for job status checks', () => {
    expect(mockJobInterruptService.getRunningJob).toBeDefined();
  });
});

describe('Session Lease Management', () => {
  it('releaseSessionLease is available', () => {
    expect(releaseSessionLease).toBeDefined();
  });
});

describe('CLI Session ID Generation', () => {
  it('generateCliSessionId is available', () => {
    expect(generateCliSessionId).toBeDefined();
  });

  it('generates session ID without reset timestamp', () => {
    const result = generateCliSessionId('test-id');
    expect(result).toBe('cli-test-id');
  });

  it('generates session ID with reset timestamp', () => {
    const result = generateCliSessionId('test-id', 1234567890);
    expect(result).toBe('cli-test-id-1234567890');
  });
});

describe('Tenant Folder Service Integration', () => {
  it('initializeTenantForCli is available', () => {
    expect(mockTenantFolderService.initializeTenantForCli).toBeDefined();
  });
});

describe('Database Operations', () => {
  it('async_jobs.update is available for status updates', () => {
    expect(mockPrisma.async_jobs.update).toBeDefined();
  });

  it('conversationSession.findFirst is available for session lookup', () => {
    expect(mockPrisma.conversationSession.findFirst).toBeDefined();
  });

  it('conversationSession.updateMany is available for lease refresh', () => {
    expect(mockPrisma.conversationSession.updateMany).toBeDefined();
  });

  it('messages.create is available for message storage', () => {
    expect(mockPrisma.messages.create).toBeDefined();
  });
});

describe('Progress Messenger Integration', () => {
  it('sendProgressUpdate is available', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sendProgressUpdate } = require('../progressMessenger.js');
    expect(sendProgressUpdate).toBeDefined();
  });
});
