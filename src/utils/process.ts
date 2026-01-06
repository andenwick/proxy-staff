import os from 'os';

/**
 * Get the lease owner identifier for this process.
 * Format: ${hostname}-${pid}
 * 
 * Used for distributed locking across sessions and browser sessions.
 */
export function getLeaseOwner(): string {
  return `${os.hostname()}-${process.pid}`;
}
