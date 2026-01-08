import { spawn, ChildProcess, execSync } from 'child_process';
import { logger } from '../../utils/logger.js';
import { generateCliSessionId } from '../claudeCli.js';
import { getTenantFolderService } from '../index.js';
import { getConfig } from '../../config/index.js';

export interface CLISession {
  tenantId: string;
  senderPhone: string;
  sessionId: string;        // DB session ID
  cliSessionId: string;     // CLI --session-id
  process: ChildProcess;
  lastMessageAt: Date;
  messageCount: number;
  isProcessing: boolean;
  isInitialized: boolean;   // Set to true when init message received
  pendingMessages: Array<{ message: string; resolve: (response: string) => void; reject: (error: Error) => void }>;
  outputBuffer: string;
  currentResolve?: (response: string) => void;
  currentReject?: (error: Error) => void;
}

// CLI stream-json output types
interface CLIContentBlock {
  type: string;
  text?: string;
}

interface CLIOutput {
  type: string;
  subtype?: string;
  message?: { content?: CLIContentBlock[] };
  result?: string;
  is_error?: boolean;
}

// Track active CLI sessions per user
// Key: tenantId:senderPhone
const sessions = new Map<string, CLISession>();

/**
 * Get the key for tracking a user's session
 */
function getUserKey(tenantId: string, senderPhone: string): string {
  return `${tenantId}:${senderPhone}`;
}

/**
 * Kill a process tree in a cross-platform way
 */
function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Process already dead
        }
      }, 2000);
    }
  } catch {
    // Process may already be dead
  }
}

/**
 * Get an existing CLI session for a user
 */
export function getSession(tenantId: string, senderPhone: string): CLISession | null {
  const key = getUserKey(tenantId, senderPhone);
  const session = sessions.get(key);

  // Check if process is still alive
  if (session && session.process.killed) {
    logger.info({ tenantId, senderPhone: senderPhone.slice(-4) }, 'CLI session process was killed, removing');
    sessions.delete(key);
    return null;
  }

  return session || null;
}

/**
 * Spawn a CLI process with given session flag
 */
async function spawnCliProcess(
  tenantId: string,
  senderPhone: string,
  tenantFolder: string,
  cliSessionId: string,
  sessionFlag: '--resume' | '--session-id'
): Promise<ChildProcess> {
  const config = getConfig();
  const args = [
    '-p',
    '--model', config.claudeModel,
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    sessionFlag, cliSessionId,
    '--setting-sources', 'user,project,local',
    '--dangerously-skip-permissions'
  ];

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4), cliSessionId, sessionFlag, args: args.join(' ') }, 'Spawning CLI process');

  const proc = spawn('claude', args, {
    cwd: tenantFolder,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: {
      ...process.env,
      TENANT_ID: tenantId,
      SENDER_PHONE: senderPhone,
      API_BASE_URL: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    },
  });

  return proc;
}

/**
 * Create a new CLI session for a user
 * Uses --resume first to load conversation history, falls back to --session-id for new conversations
 */
export async function createSession(
  tenantId: string,
  senderPhone: string,
  dbSessionId: string
): Promise<CLISession> {
  const key = getUserKey(tenantId, senderPhone);

  // Close existing session if any
  const existing = sessions.get(key);
  if (existing) {
    await closeSession(tenantId, senderPhone);
  }

  // Initialize tenant folder
  const tenantFolderService = getTenantFolderService();
  await tenantFolderService.initializeTenantForCli(tenantId);
  const tenantFolder = tenantFolderService.getTenantFolder(tenantId);

  // Use database session ID directly for CLI session to maintain conversation history
  // Don't add timestamp - we want to resume the same conversation
  const cliSessionId = generateCliSessionId(dbSessionId, 0);

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4), cliSessionId }, 'Creating new CLI session');

  // Try --resume first to load conversation history, fall back to --session-id for new conversations
  let proc = await spawnCliProcess(tenantId, senderPhone, tenantFolder, cliSessionId, '--resume');
  let usedResume = true;

  // Wait briefly and check for session errors
  // After a deploy, session files are wiped so --resume will fail
  const resumeCheckPromise = new Promise<boolean>((resolve) => {
    let stderrBuffer = '';
    let resolved = false;

    const resolveOnce = (value: boolean, reason?: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (!value) {
          logger.info({ tenantId, senderPhone: senderPhone.slice(-4), reason }, 'Resume check failed');
        }
        resolve(value);
      }
    };

    // Longer timeout to account for cold starts after deploy
    const timeout = setTimeout(() => resolveOnce(true), 2500);

    const stderrHandler = (data: Buffer) => {
      stderrBuffer += data.toString();
      const lowerStderr = stderrBuffer.toLowerCase();

      // Check for various error patterns that indicate session doesn't exist
      if (lowerStderr.includes('no conversation found') ||
          lowerStderr.includes('session not found') ||
          lowerStderr.includes('could not find') ||
          lowerStderr.includes('does not exist') ||
          lowerStderr.includes('invalid session') ||
          lowerStderr.includes('error:')) {
        resolveOnce(false, stderrBuffer.substring(0, 100));
      }
    };

    proc.stderr?.on('data', stderrHandler);

    proc.on('close', (code) => {
      // Process exited - if it exited quickly with an error, resume failed
      resolveOnce(code === 0, `process exited with code ${code}`);
    });

    proc.on('error', (err) => {
      resolveOnce(false, `spawn error: ${err.message}`);
    });
  });

  const resumeSucceeded = await resumeCheckPromise;

  if (!resumeSucceeded) {
    logger.info({ tenantId, senderPhone: senderPhone.slice(-4), cliSessionId }, 'No existing conversation, creating new session');
    // Kill the failed process and try with --session-id
    killProcessTree(proc);
    await new Promise(resolve => setTimeout(resolve, 300));
    proc = await spawnCliProcess(tenantId, senderPhone, tenantFolder, cliSessionId, '--session-id');
    usedResume = false;
  }

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4), pid: proc.pid, usedResume }, 'CLI process spawned');

  const session: CLISession = {
    tenantId,
    senderPhone,
    sessionId: dbSessionId,
    cliSessionId,
    process: proc,
    lastMessageAt: new Date(),
    messageCount: 0,
    isProcessing: false,
    isInitialized: false,
    pendingMessages: [],
    outputBuffer: '',
    currentResolve: undefined,
    currentReject: undefined,
  };

  // Handle stdout (NDJSON output)
  proc.stdout?.on('data', (data: Buffer) => {
    const chunk = data.toString();
    logger.info({ tenantId, senderPhone: senderPhone.slice(-4), chunkLength: chunk.length, chunk: chunk.substring(0, 200) }, 'CLI stdout received');
    session.outputBuffer += chunk;

    // Process complete JSON lines
    const lines = session.outputBuffer.split('\n');
    session.outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        logger.debug({ tenantId, type: parsed.type, subtype: parsed.subtype }, 'CLI output parsed');
        handleCLIOutput(session, parsed);
      } catch {
        logger.warn({ line: line.substring(0, 100) }, 'Failed to parse CLI output line');
      }
    }
  });

  // Handle stderr
  proc.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString();
    logger.warn({ tenantId, senderPhone: senderPhone.slice(-4), stderr: msg.substring(0, 200) }, 'CLI stderr');
  });

  // Handle process exit
  proc.on('close', (code: number | null) => {
    logger.info({ tenantId, senderPhone: senderPhone.slice(-4), code }, 'CLI session closed');

    // Reject any pending promises
    if (session.currentReject) {
      session.currentReject(new Error(`CLI exited with code ${code}`));
    }
    for (const pending of session.pendingMessages) {
      pending.reject(new Error(`CLI exited with code ${code}`));
    }

    // Remove from sessions
    sessions.delete(key);
  });

  proc.on('error', (error: Error) => {
    logger.error({ tenantId, senderPhone: senderPhone.slice(-4), error: error.message }, 'CLI session error');

    if (session.currentReject) {
      session.currentReject(error);
    }

    sessions.delete(key);
  });

  sessions.set(key, session);

  // Give CLI a moment to start, then consider it ready
  // stream-json mode may not send an init message until input is received
  await new Promise(resolve => setTimeout(resolve, 500));

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4), cliSessionId, pid: proc.pid }, 'CLI session ready');

  return session;
}

/**
 * Handle parsed CLI output
 */
function handleCLIOutput(session: CLISession, output: CLIOutput): void {
  if (output.type === 'system' && output.subtype === 'init') {
    session.isInitialized = true;
    logger.debug({ sessionId: session.cliSessionId }, 'CLI initialized');
    return;
  }

  if (output.type === 'assistant') {
    // Extract response text
    const content = output.message?.content;
    if (content && Array.isArray(content)) {
      const textContent = content.find((c: CLIContentBlock) => c.type === 'text');
      if (textContent?.text && session.currentResolve) {
        // Don't resolve yet - wait for result message
      }
    }
  }

  if (output.type === 'result') {
    session.isProcessing = false;

    if (output.subtype === 'success' && session.currentResolve) {
      session.currentResolve(output.result || '');
      session.currentResolve = undefined;
      session.currentReject = undefined;
    } else if (output.is_error && session.currentReject) {
      session.currentReject(new Error(output.result || 'CLI error'));
      session.currentResolve = undefined;
      session.currentReject = undefined;
    }

    // Process next pending message if any
    processNextMessage(session);
  }
}

/**
 * Process the next pending message in the queue
 */
function processNextMessage(session: CLISession): void {
  if (session.isProcessing || session.pendingMessages.length === 0) {
    return;
  }

  const next = session.pendingMessages.shift();
  if (!next) return;

  session.isProcessing = true;
  session.currentResolve = next.resolve;
  session.currentReject = next.reject;

  // Send the message
  const msg = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: next.message }]
    }
  };

  session.process.stdin?.write(JSON.stringify(msg) + '\n');
}

/**
 * Inject a message into an existing CLI session
 */
export function injectMessage(session: CLISession, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    session.lastMessageAt = new Date();
    session.messageCount++;

    logger.debug({
      tenantId: session.tenantId,
      senderPhone: session.senderPhone.slice(-4),
      messageCount: session.messageCount,
      isProcessing: session.isProcessing
    }, 'Injecting message into CLI session');

    if (session.isProcessing) {
      // Queue the message
      session.pendingMessages.push({ message, resolve, reject });
    } else {
      // Send immediately
      session.isProcessing = true;
      session.currentResolve = resolve;
      session.currentReject = reject;

      const msg = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: message }]
        }
      };

      session.process.stdin?.write(JSON.stringify(msg) + '\n');
    }
  });
}

/**
 * Close a CLI session
 */
export async function closeSession(tenantId: string, senderPhone: string): Promise<void> {
  const key = getUserKey(tenantId, senderPhone);
  const session = sessions.get(key);

  if (!session) {
    return;
  }

  logger.info({ tenantId, senderPhone: senderPhone.slice(-4) }, 'Closing CLI session');

  // End stdin to signal completion
  try {
    session.process.stdin?.end();
  } catch {
    // Ignore
  }

  // Give it a moment to close gracefully
  await new Promise(resolve => setTimeout(resolve, 500));

  // Force kill if still running
  if (!session.process.killed) {
    killProcessTree(session.process);
  }

  sessions.delete(key);
}

/**
 * Close all CLI sessions (for shutdown)
 */
export async function closeAllSessions(): Promise<number> {
  const count = sessions.size;

  logger.info({ count }, 'Closing all CLI sessions');

  const closePromises: Promise<void>[] = [];

  for (const [, session] of sessions) {
    closePromises.push(closeSession(session.tenantId, session.senderPhone));
  }

  await Promise.all(closePromises);

  return count;
}

/**
 * Get count of active CLI sessions
 */
export function getSessionCount(): number {
  return sessions.size;
}

/**
 * Check if a user has an active CLI session
 */
export function hasSession(tenantId: string, senderPhone: string): boolean {
  return getSession(tenantId, senderPhone) !== null;
}
