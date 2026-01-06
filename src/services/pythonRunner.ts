import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

// Default timeout: 30 seconds
const DEFAULT_TIMEOUT_MS = 30 * 1000;

// Maximum output size: 1MB (prevent memory exhaustion)
const MAX_OUTPUT_BYTES = 1024 * 1024;

// Maximum concurrent Python processes per service instance
const MAX_CONCURRENT_PROCESSES = 10;

export class PythonRunnerService {
  private timeoutMs: number;
  private activeProcesses: Set<ChildProcess> = new Set();

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Get count of currently running processes.
   */
  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Kill all active processes (for graceful shutdown).
   */
  killAllProcesses(): void {
    for (const proc of this.activeProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
    }
    this.activeProcesses.clear();
    logger.info('Killed all active Python processes');
  }

  /**
   * Run a Python script with JSON input via stdin.
   * Returns stdout on success, throws error on non-zero exit or timeout.
   *
   * @param scriptPath - Absolute path to the Python script
   * @param input - Object to pass as JSON via stdin
   * @param envPath - Optional path to .env file to load into subprocess environment
   */
  async runPythonScript(
    scriptPath: string,
    input: Record<string, unknown>,
    envPath?: string
  ): Promise<string> {
    // Rate limit: prevent too many concurrent processes
    if (this.activeProcesses.size >= MAX_CONCURRENT_PROCESSES) {
      throw new Error(`Too many concurrent Python processes (max ${MAX_CONCURRENT_PROCESSES})`);
    }

    return new Promise((resolve, reject) => {
      // Build environment for subprocess
      const env: NodeJS.ProcessEnv = { ...process.env };

      // Load tenant's .env file if provided
      logger.info({ envPath, exists: envPath ? fs.existsSync(envPath) : false }, 'Checking tenant .env file');
      if (envPath && fs.existsSync(envPath)) {
        try {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const parsedEnv = dotenv.parse(envContent);
          Object.assign(env, parsedEnv);
          logger.info({ envPath, keys: Object.keys(parsedEnv) }, 'Loaded tenant .env file');
        } catch (error) {
          logger.warn({ envPath, error }, 'Failed to parse tenant .env file, continuing without it');
        }
      }

      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, this.timeoutMs);

      // Spawn Python process
      const pythonProcess = spawn('python', [scriptPath], {
        env,
        signal: abortController.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Track active process for cleanup
      this.activeProcesses.add(pythonProcess);

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputLimitExceeded = false;

      // Helper to cleanup process
      const cleanup = () => {
        this.activeProcesses.delete(pythonProcess);
        clearTimeout(timeoutId);
      };

      // Helper to kill process safely
      const killProcess = () => {
        try {
          pythonProcess.kill('SIGTERM');
          // Force kill after 1 second if still running
          setTimeout(() => {
            try {
              pythonProcess.kill('SIGKILL');
            } catch {
              // Already dead
            }
          }, 1000);
        } catch {
          // Process may already be dead
        }
      };

      // Collect stdout with size limit
      pythonProcess.stdout.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          if (!outputLimitExceeded) {
            outputLimitExceeded = true;
            logger.warn({ scriptPath, bytes: stdoutBytes }, 'Python script output exceeded limit, killing process');
            killProcess();
          }
          return;
        }
        stdout += data.toString();
      });

      // Collect stderr with size limit
      pythonProcess.stderr.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          return; // Just drop excess stderr
        }
        stderr += data.toString();
      });

      // Handle process completion
      pythonProcess.on('close', (code: number | null) => {
        cleanup();

        if (outputLimitExceeded) {
          reject(new Error('Python script output exceeded maximum size limit'));
          return;
        }

        // Log stderr for debugging if there's any output
        if (stderr.trim()) {
          logger.debug({ scriptPath, stderr: stderr.trim() }, 'Python script stderr output');
        }

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const errorMessage = stderr.trim() || `Script exited with code ${code}`;
          logger.error({ scriptPath, code, stderr: errorMessage, stdout: stdout.trim() }, 'Python script failed');
          reject(new Error(`Python script failed: ${stdout.trim() || errorMessage}`));
        }
      });

      // Handle spawn errors
      pythonProcess.on('error', (error: Error) => {
        cleanup();

        // Check if this is an abort error (timeout)
        if (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR') {
          logger.error({ scriptPath, timeoutMs: this.timeoutMs }, 'Python script timed out');
          killProcess(); // Ensure process is killed on timeout
          reject(new Error(`Python script timed out after ${this.timeoutMs}ms`));
        } else {
          logger.error({ scriptPath, error }, 'Failed to spawn Python process');
          reject(error);
        }
      });

      // Handle stdin errors
      pythonProcess.stdin.on('error', (error: Error) => {
        logger.warn({ scriptPath, error: error.message }, 'Error writing to Python stdin');
        // Don't reject here - let the process complete/fail naturally
      });

      // Write input as JSON to stdin and close
      const jsonInput = JSON.stringify(input);
      pythonProcess.stdin.write(jsonInput);
      pythonProcess.stdin.end();
    });
  }
}
