import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

export type ActionType = 'send_email' | 'send_linkedin' | 'send_sms' | 'call';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';

export interface QueuedAction {
  id: string;
  campaign_id: string;
  campaign_name: string;
  target_id: string;
  target_name: string;
  target_email?: string;
  target_linkedin?: string;
  target_phone?: string;
  action_type: ActionType;
  channel: string;
  subject?: string;
  body: string;
  reasoning: string;
  queued_at: string;
  expires_at: string;
  status: ApprovalStatus;
}

export interface ApprovalHistory {
  id: string;
  action_type: ActionType;
  target_name: string;
  status: ApprovalStatus;
  approved_at?: string;
  executed_at?: string;
  rejected_at?: string;
  error?: string;
}

export interface PendingApprovalsData {
  version: number;
  lastUpdated: string;
  pending: QueuedAction[];
  history: ApprovalHistory[];
}

export interface ExecutionResult {
  action_id: string;
  status: 'success' | 'failed';
  error?: string;
  message_id?: string;
}

/**
 * ApprovalQueueService manages the approval queue for campaign outreach actions.
 *
 * Queue data is stored at: tenants/{tenantId}/state/pending_approvals.json
 */
export class ApprovalQueueService {
  private projectRoot: string;
  private defaultExpireDays: number;

  constructor(projectRoot?: string, defaultExpireDays = 3) {
    this.projectRoot = projectRoot ?? process.cwd();
    this.defaultExpireDays = defaultExpireDays;
  }

  /**
   * Get the path to the pending approvals file.
   */
  private getApprovalsPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'state', 'pending_approvals.json');
  }

  /**
   * Load the approvals data file.
   */
  private async loadApprovalsData(tenantId: string): Promise<PendingApprovalsData> {
    const filePath = this.getApprovalsPath(tenantId);

    if (!fs.existsSync(filePath)) {
      // Initialize with default structure
      const data: PendingApprovalsData = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        pending: [],
        history: [],
      };

      // Ensure state directory exists
      const stateDir = path.dirname(filePath);
      await fs.promises.mkdir(stateDir, { recursive: true });

      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return data;
    }

    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as PendingApprovalsData;
  }

  /**
   * Save the approvals data file.
   */
  private async saveApprovalsData(tenantId: string, data: PendingApprovalsData): Promise<void> {
    const filePath = this.getApprovalsPath(tenantId);
    data.lastUpdated = new Date().toISOString();
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Queue an action for approval.
   */
  async queueAction(
    tenantId: string,
    action: Omit<QueuedAction, 'id' | 'queued_at' | 'expires_at' | 'status'>
  ): Promise<string> {
    const data = await this.loadApprovalsData(tenantId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.defaultExpireDays * 24 * 60 * 60 * 1000);

    const queuedAction: QueuedAction = {
      id: randomUUID(),
      ...action,
      queued_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: 'pending',
    };

    data.pending.push(queuedAction);

    await this.saveApprovalsData(tenantId, data);

    logger.debug(
      { tenantId, actionId: queuedAction.id, actionType: action.action_type },
      'Action queued for approval'
    );

    return queuedAction.id;
  }

  /**
   * List pending actions.
   */
  async listPendingActions(tenantId: string, campaignId?: string): Promise<QueuedAction[]> {
    const data = await this.loadApprovalsData(tenantId);

    // Filter out expired actions
    const now = new Date();
    let pending = data.pending.filter((action) => {
      return action.status === 'pending' && new Date(action.expires_at) > now;
    });

    // Filter by campaign if specified
    if (campaignId) {
      pending = pending.filter((action) => action.campaign_id === campaignId);
    }

    return pending;
  }

  /**
   * Get count of pending actions.
   */
  async getPendingCount(tenantId: string): Promise<number> {
    const pending = await this.listPendingActions(tenantId);
    return pending.length;
  }

  /**
   * Approve specific actions by ID.
   */
  async approveActions(tenantId: string, actionIds: string[]): Promise<number> {
    const data = await this.loadApprovalsData(tenantId);
    const now = new Date().toISOString();
    let approvedCount = 0;

    for (const action of data.pending) {
      if (actionIds.includes(action.id) && action.status === 'pending') {
        action.status = 'approved';

        // Add to history
        data.history.unshift({
          id: action.id,
          action_type: action.action_type,
          target_name: action.target_name,
          status: 'approved',
          approved_at: now,
        });

        approvedCount++;
      }
    }

    await this.saveApprovalsData(tenantId, data);

    logger.info({ tenantId, approvedCount }, 'Actions approved');

    return approvedCount;
  }

  /**
   * Approve all pending actions for a campaign (or all campaigns).
   */
  async approveAll(tenantId: string, campaignId?: string): Promise<number> {
    const data = await this.loadApprovalsData(tenantId);
    const now = new Date().toISOString();
    let approvedCount = 0;

    for (const action of data.pending) {
      if (action.status !== 'pending') continue;
      if (campaignId && action.campaign_id !== campaignId) continue;

      action.status = 'approved';

      // Add to history
      data.history.unshift({
        id: action.id,
        action_type: action.action_type,
        target_name: action.target_name,
        status: 'approved',
        approved_at: now,
      });

      approvedCount++;
    }

    await this.saveApprovalsData(tenantId, data);

    logger.info({ tenantId, campaignId, approvedCount }, 'All actions approved');

    return approvedCount;
  }

  /**
   * Reject specific actions by ID.
   */
  async rejectActions(tenantId: string, actionIds: string[]): Promise<number> {
    const data = await this.loadApprovalsData(tenantId);
    const now = new Date().toISOString();
    let rejectedCount = 0;

    for (const action of data.pending) {
      if (actionIds.includes(action.id) && action.status === 'pending') {
        action.status = 'rejected';

        // Add to history
        data.history.unshift({
          id: action.id,
          action_type: action.action_type,
          target_name: action.target_name,
          status: 'rejected',
          rejected_at: now,
        });

        rejectedCount++;
      }
    }

    // Remove rejected from pending
    data.pending = data.pending.filter((a) => a.status === 'pending' || a.status === 'approved');

    await this.saveApprovalsData(tenantId, data);

    logger.info({ tenantId, rejectedCount }, 'Actions rejected');

    return rejectedCount;
  }

  /**
   * Get approved actions ready for execution.
   */
  async getApprovedActions(tenantId: string): Promise<QueuedAction[]> {
    const data = await this.loadApprovalsData(tenantId);
    return data.pending.filter((action) => action.status === 'approved');
  }

  /**
   * Mark an action as executed.
   */
  async markExecuted(
    tenantId: string,
    actionId: string,
    success: boolean,
    error?: string,
    messageId?: string
  ): Promise<void> {
    const data = await this.loadApprovalsData(tenantId);
    const now = new Date().toISOString();

    const actionIndex = data.pending.findIndex((a) => a.id === actionId);
    if (actionIndex === -1) {
      logger.warn({ tenantId, actionId }, 'Action not found for marking executed');
      return;
    }

    const action = data.pending[actionIndex];
    action.status = success ? 'executed' : 'pending'; // Retry failed actions

    // Update history
    const historyIndex = data.history.findIndex((h) => h.id === actionId);
    if (historyIndex !== -1) {
      data.history[historyIndex].status = success ? 'executed' : 'approved';
      data.history[historyIndex].executed_at = success ? now : undefined;
      if (error) {
        data.history[historyIndex].error = error;
      }
    }

    // Remove executed from pending
    if (success) {
      data.pending.splice(actionIndex, 1);
    }

    await this.saveApprovalsData(tenantId, data);

    logger.debug({ tenantId, actionId, success, error }, 'Action execution recorded');
  }

  /**
   * Expire old pending actions.
   */
  async expireOldActions(tenantId: string): Promise<number> {
    const data = await this.loadApprovalsData(tenantId);
    const now = new Date();
    let expiredCount = 0;

    for (const action of data.pending) {
      if (action.status === 'pending' && new Date(action.expires_at) <= now) {
        action.status = 'expired';

        // Add to history
        data.history.unshift({
          id: action.id,
          action_type: action.action_type,
          target_name: action.target_name,
          status: 'expired',
        });

        expiredCount++;
      }
    }

    // Remove expired from pending
    data.pending = data.pending.filter((a) => a.status !== 'expired');

    if (expiredCount > 0) {
      await this.saveApprovalsData(tenantId, data);
      logger.info({ tenantId, expiredCount }, 'Expired old actions');
    }

    return expiredCount;
  }

  /**
   * Get action by ID.
   */
  async getAction(tenantId: string, actionId: string): Promise<QueuedAction | null> {
    const data = await this.loadApprovalsData(tenantId);
    return data.pending.find((a) => a.id === actionId) ?? null;
  }

  /**
   * Get recent history.
   */
  async getHistory(tenantId: string, limit = 50): Promise<ApprovalHistory[]> {
    const data = await this.loadApprovalsData(tenantId);
    return data.history.slice(0, limit);
  }

  /**
   * Clear all pending actions (for testing/reset).
   */
  async clearPending(tenantId: string): Promise<void> {
    const data = await this.loadApprovalsData(tenantId);
    data.pending = [];
    await this.saveApprovalsData(tenantId, data);
    logger.info({ tenantId }, 'Cleared all pending actions');
  }
}
