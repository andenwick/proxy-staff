import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

/**
 * TimelineService manages daily journal files for tenant event logging.
 *
 * Journal files are stored at: tenants/{tenantId}/timeline/YYYY-MM-DD.md
 *
 * Events logged:
 * - Messages (inbound/outbound)
 * - Tool executions (success/failure)
 */
export class TimelineService {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Get the path to a tenant's timeline folder.
   */
  private getTimelineFolder(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'timeline');
  }

  /**
   * Get the path to a specific day's journal file.
   */
  private getJournalPath(tenantId: string, date?: Date): string {
    const d = date ?? new Date();
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.getTimelineFolder(tenantId), `${dateStr}.md`);
  }

  /**
   * Get current time as HH:MM:SS string.
   */
  private getTimeString(): string {
    const now = new Date();
    return now.toTimeString().split(' ')[0]; // HH:MM:SS
  }

  /**
   * Ensure the timeline folder and today's journal file exist.
   * Creates the journal with a header if it doesn't exist.
   */
  async ensureJournal(tenantId: string): Promise<string> {
    const timelineFolder = this.getTimelineFolder(tenantId);
    const journalPath = this.getJournalPath(tenantId);

    // Ensure timeline folder exists
    await fs.promises.mkdir(timelineFolder, { recursive: true });

    // Create journal with header if it doesn't exist
    if (!fs.existsSync(journalPath)) {
      const dateStr = new Date().toISOString().split('T')[0];
      const header = `# Timeline - ${dateStr}\n\n## Events\n\n`;
      await fs.promises.writeFile(journalPath, header, 'utf-8');
      logger.debug({ tenantId, journalPath }, 'Created new timeline journal');
    }

    return journalPath;
  }

  /**
   * Append an event entry to today's journal.
   */
  private async appendEntry(tenantId: string, entry: string): Promise<void> {
    try {
      const journalPath = await this.ensureJournal(tenantId);
      await fs.promises.appendFile(journalPath, entry, 'utf-8');
    } catch (error) {
      // Timeline logging should never break message processing
      logger.error({ tenantId, error }, 'Failed to write timeline entry');
    }
  }

  /**
   * Log a message event (inbound or outbound).
   */
  async logMessage(
    tenantId: string,
    direction: 'inbound' | 'outbound',
    content: string,
    phone: string
  ): Promise<void> {
    const time = this.getTimeString();
    const dirLabel = direction === 'inbound' ? 'Inbound from' : 'Outbound to';

    // Truncate content for journal (keep first 200 chars)
    const preview = content.length > 200
      ? content.substring(0, 200) + '...'
      : content;

    const entry = `### ${time} [MESSAGE] ${dirLabel} ${phone}\n${preview}\n\n---\n\n`;
    await this.appendEntry(tenantId, entry);
  }

  /**
   * Log a tool execution event.
   */
  async logToolExecution(
    tenantId: string,
    toolName: string,
    status: 'success' | 'failure',
    durationMs: number,
    summary?: string
  ): Promise<void> {
    const time = this.getTimeString();
    const summaryLine = summary ? `\n${summary}` : '';

    const entry = `### ${time} [TOOL] ${toolName} (${status}, ${durationMs}ms)${summaryLine}\n\n---\n\n`;
    await this.appendEntry(tenantId, entry);
  }

  /**
   * Log a custom event.
   */
  async logEvent(
    tenantId: string,
    eventType: string,
    description: string
  ): Promise<void> {
    const time = this.getTimeString();

    const entry = `### ${time} [${eventType.toUpperCase()}] ${description}\n\n---\n\n`;
    await this.appendEntry(tenantId, entry);
  }
}
