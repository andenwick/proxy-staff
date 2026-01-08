import { spawn, ChildProcess, execSync } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { ClaudeCliError } from '../errors/index.js';
import { incrementCounter, recordTiming } from '../utils/metrics.js';
import { getPrismaClient } from './prisma.js';
import { getConfig } from '../config/index.js';

/**
 * Kill a process in a cross-platform way.
 * On Windows, uses taskkill to kill the entire process tree.
 * On Unix, uses SIGTERM followed by SIGKILL.
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;

  try {
    if (process.platform === 'win32') {
      // Windows: use taskkill to kill entire process tree
      // /F = force, /T = tree (kill child processes), /PID = process ID
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      // Unix: SIGTERM for graceful shutdown
      proc.kill('SIGTERM');
      // Force kill after 2 seconds if still running
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Already dead
        }
      }, 2000);
    }
  } catch {
    // Process may already be dead
  }
}

// Default timeout: 5 minutes
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Progress update interval: 5 minutes
const PROGRESS_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Callback function for progress updates during long-running CLI operations.
 * Called periodically with elapsed time in milliseconds.
 */
export type ProgressCallback = (elapsedMs: number) => Promise<void>;

/**
 * Generate a deterministic CLI session ID from a database session ID.
 * The CLI session ID is derived as a hash of the DB session ID, maintaining UUID format.
 * When resetTimestamp is provided, it's included in the hash to invalidate old sessions.
 * Returns a valid UUID format (8-4-4-4-12).
 */
export function generateCliSessionId(
  dbSessionId: string,
  resetTimestamp?: number
): string {
  const input = resetTimestamp
    ? `${dbSessionId}:${resetTimestamp}`
    : dbSessionId;
  const hash = crypto
    .createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, 32);
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export class ClaudeCliService {
  private timeoutMs: number;
  // Track active CLI processes for cleanup on shutdown
  private activeProcesses: Set<ChildProcess> = new Set();
  // Per-session mutex to prevent concurrent CLI calls (single-instance optimization)
  private sessionLocks: Map<string, Promise<void>> = new Map();

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Stop the service and cleanup resources.
   */
  stop(): void {
    this.killAllProcesses();
    logger.info('ClaudeCliService stopped');
  }

  /**
   * Kill all active CLI processes (for graceful shutdown).
   */
  killAllProcesses(): void {
    const count = this.activeProcesses.size;
    for (const proc of this.activeProcesses) {
      killProcessTree(proc);
    }
    this.activeProcesses.clear();
    logger.info({ count }, 'Killed all active Claude CLI processes');
  }

  /**
   * Get count of active CLI processes.
   */
  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Get the key for session operations.
   */
  private getSessionKey(tenantId: string, senderPhone: string): string {
    return `${tenantId}:${senderPhone}`;
  }

  /**
   * Get the current CLI session ID for a tenant+phone combination.
   * Reads the DB session ID and reset_timestamp from the database.
   */
  async getSessionId(tenantId: string, senderPhone: string): Promise<string | null> {
    const prisma = getPrismaClient();

    // Find the active session for this tenant+phone
    const session = await prisma.conversationSession.findFirst({
      where: {
        tenant_id: tenantId,
        sender_phone: senderPhone,
        ended_at: null,
      },
      orderBy: {
        started_at: 'desc',
      },
      select: {
        id: true,
        reset_timestamp: true,
      },
    });

    if (!session) {
      return null;
    }

    // Generate CLI session ID from DB session ID
    const resetTimestamp = session.reset_timestamp?.getTime();
    return generateCliSessionId(session.id, resetTimestamp);
  }

  /**
   * Reset the CLI session for a tenant+phone combination.
   * Updates the reset_timestamp in the database to invalidate the old CLI session.
   */
  async resetSession(tenantId: string, senderPhone: string): Promise<void> {
    const prisma = getPrismaClient();
    const newTimestamp = new Date();

    // Update reset_timestamp for all active sessions (should be at most one)
    const result = await prisma.conversationSession.updateMany({
      where: {
        tenant_id: tenantId,
        sender_phone: senderPhone,
        ended_at: null,
      },
      data: {
        reset_timestamp: newTimestamp,
      },
    });

    logger.info(
      { tenantId, senderPhone, newTimestamp, updatedCount: result.count },
      'CLI session reset - new session ID will be used'
    );
  }

  /**
   * Acquire mutex for a session to prevent concurrent CLI calls.
   */
  private async acquireSessionLock(sessionKey: string): Promise<void> {
    // Wait for any existing operation to complete
    const existingLock = this.sessionLocks.get(sessionKey);
    if (existingLock) {
      await existingLock;
    }
  }

  /**
   * Create a new lock promise and store it.
   */
  private createSessionLock(sessionKey: string): { release: () => void } {
    let releaseResolve: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    this.sessionLocks.set(sessionKey, lockPromise);
    return {
      release: () => {
        releaseResolve();
        this.sessionLocks.delete(sessionKey);
      },
    };
  }

  /**
   * Send a message to Claude CLI and get the response.
   * Uses --resume for existing sessions, falls back to --session-id for new sessions.
   * Uses per-session mutex to prevent concurrent CLI calls for the same user.
   */
  async sendMessage(
    tenantId: string,
    senderPhone: string,
    message: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const sessionKey = this.getSessionKey(tenantId, senderPhone);

    // Acquire session lock (wait for any concurrent operation to complete)
    await this.acquireSessionLock(sessionKey);
    const lock = this.createSessionLock(sessionKey);

    try {
      const sessionId = await this.getSessionId(tenantId, senderPhone);

      // If no session exists yet, we need a fallback session ID
      // This can happen for new conversations before session is created
      const effectiveSessionId = sessionId || generateCliSessionId(`${tenantId}:${senderPhone}`);

      const tenantFolder = path.resolve(process.cwd(), 'tenants', tenantId);

      // Build environment variables for shared_tools Python scripts
      const toolEnv = {
        TENANT_ID: tenantId,
        SENDER_PHONE: senderPhone,
        API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
      };

      // Try --resume first (for existing sessions), fall back to --session-id (for new sessions)
      try {
        return await this.spawnCli(tenantFolder, effectiveSessionId, message, '--resume', toolEnv, onProgress);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('No conversation found')) {
          logger.info({ tenantId, sessionId: effectiveSessionId }, 'No existing session, creating new one');
          return await this.spawnCli(tenantFolder, effectiveSessionId, message, '--session-id', toolEnv, onProgress);
        }
        throw error;
      }
    } finally {
      lock.release();
    }
  }

  /**
   * Spawn Claude CLI with the specified session flag.
   * Includes proper process tracking, cleanup, and error handling.
   */
  private spawnCli(
    tenantFolder: string,
    sessionId: string,
    message: string,
    sessionFlag: '--resume' | '--session-id',
    toolEnv: Record<string, string> = {},
    onProgress?: ProgressCallback
  ): Promise<string> {
    const requestStart = Date.now();

    return new Promise((resolve, reject) => {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, this.timeoutMs);

      const config = getConfig();
      const args = ['-p', '--model', config.claudeModel, sessionFlag, sessionId, '--setting-sources', 'user,project,local', '--dangerously-skip-permissions'];
      logger.info(
        { sessionId, cwd: tenantFolder, sessionFlag, args: args.join(' '), messageLength: message.length },
        'Spawning Claude CLI subprocess'
      );

      // Use 'claude' with shell: true - Windows cmd.exe resolves .cmd extension automatically
      // HOME must be set explicitly for Claude CLI to find credentials on Linux containers
      // (su-exec doesn't set HOME, so spawned processes inherit root's HOME or no HOME)
      const cliProcess = spawn('claude', args, {
        cwd: tenantFolder,
        signal: abortController.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env, ...toolEnv, HOME: process.env.HOME || '/home/nodejs' },
      });

      // Track active process for cleanup on shutdown
      this.activeProcesses.add(cliProcess);

      let stdout = '';
      let stderr = '';

      // Set up progress interval if callback provided
      let progressIntervalId: ReturnType<typeof setInterval> | null = null;
      if (onProgress) {
        progressIntervalId = setInterval(async () => {
          const elapsedMs = Date.now() - requestStart;
          try {
            await onProgress(elapsedMs);
            logger.debug({ sessionId, elapsedMs }, 'Progress callback executed');
          } catch (error) {
            logger.warn({ sessionId, error }, 'Progress callback failed (non-fatal)');
          }
        }, PROGRESS_INTERVAL_MS);
      }

      // Helper to cleanup process tracking, timeout, and progress interval
      const cleanup = () => {
        this.activeProcesses.delete(cliProcess);
        clearTimeout(timeoutId);
        if (progressIntervalId) {
          clearInterval(progressIntervalId);
        }
      };

      // Helper to kill process safely (cross-platform)
      const killProcess = () => {
        killProcessTree(cliProcess);
      };

      cliProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      cliProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      cliProcess.on('close', (code: number | null) => {
        cleanup();
        const durationMs = Date.now() - requestStart;

        if (stderr.trim()) {
          logger.debug({ sessionId, stderr: stderr.trim() }, 'Claude CLI stderr output');
        }

        if (code === 0) {
          recordTiming('claude_cli_request_ms', durationMs, { status: 'ok' });
          incrementCounter('claude_cli_requests', { status: 'ok' });
          logger.info(
            { sessionId, durationMs, responseLength: stdout.length },
            'Claude CLI completed successfully'
          );
          resolve(stdout.trim());
        } else {
          recordTiming('claude_cli_request_ms', durationMs, { status: 'error' });
          incrementCounter('claude_cli_requests', { status: 'error' });
          // Capture both stderr and stdout for debugging - CLI may output errors to stdout
          const stderrMsg = stderr.trim();
          const stdoutMsg = stdout.trim();
          const errorMessage = stderrMsg || stdoutMsg || `CLI exited with code ${code}`;
          logger.error({ sessionId, code, stderr: stderrMsg, stdout: stdoutMsg }, 'Claude CLI failed');
          reject(new ClaudeCliError(`Claude CLI failed: ${errorMessage}`));
        }
      });

      cliProcess.on('error', (error: Error) => {
        cleanup();
        const durationMs = Date.now() - requestStart;
        recordTiming('claude_cli_request_ms', durationMs, { status: 'error' });
        incrementCounter('claude_cli_requests', { status: 'error' });

        if (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR') {
          logger.error({ sessionId, timeoutMs: this.timeoutMs }, 'Claude CLI timed out');
          killProcess(); // Ensure process is killed on timeout
          reject(new ClaudeCliError(`Claude CLI timed out after ${this.timeoutMs}ms`));
        } else {
          logger.error({ sessionId, error }, 'Failed to spawn Claude CLI process');
          killProcess(); // Cleanup on error
          reject(new ClaudeCliError(`Failed to spawn Claude CLI: ${error.message}`));
        }
      });

      // Handle stdin errors gracefully
      cliProcess.stdin.on('error', (error: Error) => {
        logger.warn({ sessionId, error: error.message }, 'Error writing to CLI stdin');
        // Don't reject here - let the process complete/fail naturally
      });

      logger.debug({ sessionId, messagePreview: message.substring(0, 100) }, 'Writing message to CLI stdin');
      cliProcess.stdin.write(message);
      cliProcess.stdin.end();
      logger.debug({ sessionId }, 'CLI stdin closed, waiting for response');
    });
  }
}
