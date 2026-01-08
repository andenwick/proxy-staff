import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';
import { ProspectService, ProspectData, ProspectStage } from './prospectService.js';

/**
 * Campaign stages in order of progression.
 */
export type CampaignStage =
  | 'identified'
  | 'researched'
  | 'contacted'
  | 'replied'
  | 'qualified'
  | 'booked'
  | 'won'
  | 'lost';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

/**
 * Response mode determines how events are processed.
 * - 'delayed': Log only on webhook, scheduler processes with timing delays (for sales)
 * - 'immediate': Process immediately on webhook (for customer service)
 */
export type ResponseMode = 'delayed' | 'immediate';

export interface CampaignChannelConfig {
  enabled: boolean;
  provider?: string;
}

export interface CampaignSettings {
  max_daily_outreach: number;
  min_days_between_touches: number;
  max_touches_per_target: number;
  require_approval: boolean;
  approval_mode: 'batch' | 'individual';
  // Response timing configuration
  response_delay_min_hours?: number;
  response_delay_max_hours?: number;
  business_hours_only?: boolean;
  business_hours_start?: string; // "HH:MM" format
  business_hours_end?: string; // "HH:MM" format
  business_hours_timezone?: string;
  response_mode?: ResponseMode;
}

/**
 * Default timing settings for campaigns.
 */
export const DEFAULT_CAMPAIGN_TIMING = {
  response_delay_min_hours: 1,
  response_delay_max_hours: 4,
  business_hours_only: true,
  business_hours_start: '09:00',
  business_hours_end: '17:00',
  business_hours_timezone: 'America/Denver',
  response_mode: 'delayed' as ResponseMode,
};

export interface CampaignAudience {
  description: string;
  industries: string[];
  company_size: string;
  locations: string[];
}

export interface CampaignConfig {
  version: number;
  id: string;
  name: string;
  status: CampaignStatus;
  created_at: string;
  lastUpdated: string;
  owner_phone: string;
  goal: string;
  audience: CampaignAudience;
  channels: {
    email: CampaignChannelConfig;
    linkedin: CampaignChannelConfig;
    sms: CampaignChannelConfig;
    calls: CampaignChannelConfig;
  };
  settings: CampaignSettings;
  metrics_snapshot: {
    total_targets: number;
    by_stage: Record<CampaignStage, number>;
  };
}

export interface TargetResearch {
  summary: string;
  news: string[];
  mutual_connections: string[];
  researched_at: string;
}

export interface TargetTouch {
  id: string;
  channel: string;
  sent_at: string;
  subject?: string;
  message_preview: string;
  status: 'pending' | 'delivered' | 'opened' | 'replied' | 'bounced';
  opened?: boolean;
  replied?: boolean;
}

export interface TargetNextAction {
  type: string;
  scheduled_for: string;
  reason: string;
}

/**
 * Legacy Target interface (inline data format).
 * Used for backward compatibility with existing campaign data.
 */
export interface Target {
  id: string;
  stage: CampaignStage;
  name: string;
  title?: string;
  company?: string;
  email?: string;
  linkedin?: string;
  phone?: string;
  research?: TargetResearch;
  touches: TargetTouch[];
  next_action?: TargetNextAction;
  unsubscribed: boolean;
  created_at: string;
  stage_changed_at: string;
}

/**
 * New TargetReference interface (prospect slug reference format).
 * Stores only the reference to a prospect file plus campaign-specific metadata.
 */
export interface TargetReference {
  id: string;
  prospect_slug: string;
  added_at: string;
  last_touch_at: string | null;
  touch_count: number;
  campaign_stage: CampaignStage;
  unsubscribed: boolean;
}

/**
 * Combined target and prospect context for processing.
 */
export interface TargetWithContext {
  target: TargetReference;
  prospect: ProspectData | null;
}

export interface TargetsData {
  version: number;
  lastUpdated: string;
  targets: Target[];
}

/**
 * New targets data format with references.
 */
export interface TargetReferencesData {
  version: number;
  lastUpdated: string;
  target_references: TargetReference[];
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  config: CampaignConfig;
  targetsCount: number;
}

/**
 * CampaignService manages campaign files in tenant folders.
 *
 * Campaign files are stored at: tenants/{tenantId}/operations/campaigns/{campaign-name}/
 * - config.md (campaign configuration)
 * - targets.md (prospect list)
 * - sequence.md (AI instructions)
 * - metrics.md (performance tracking)
 * - log.md (activity log)
 */
export class CampaignService {
  private projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Get the path to a tenant's campaigns folder.
   */
  private getCampaignsFolder(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'operations', 'campaigns');
  }

  /**
   * Get the path to a specific campaign folder.
   */
  private getCampaignFolder(tenantId: string, campaignName: string): string {
    const safeName = campaignName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    return path.join(this.getCampaignsFolder(tenantId), safeName);
  }

  /**
   * Parse JSON frontmatter from markdown content.
   */
  private parseFrontmatter<T>(content: string): { data: T; markdown: string } {
    const pattern = /^---json\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
    const match = content.match(pattern);

    if (match) {
      try {
        const data = JSON.parse(match[1]) as T;
        const markdown = match[2];
        return { data, markdown };
      } catch {
        throw new Error('Invalid JSON in frontmatter');
      }
    }

    throw new Error('No valid frontmatter found');
  }

  /**
   * Serialize data and markdown to frontmatter format.
   */
  private serializeFrontmatter<T>(data: T, markdown: string): string {
    const jsonStr = JSON.stringify(data, null, 2);
    return `---json\n${jsonStr}\n---\n${markdown}`;
  }

  /**
   * Read a campaign file.
   */
  private async readCampaignFile<T>(filePath: string): Promise<{ data: T; markdown: string }> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return this.parseFrontmatter<T>(content);
  }

  /**
   * Write a campaign file.
   */
  private async writeCampaignFile<T>(filePath: string, data: T, markdown: string): Promise<void> {
    const content = this.serializeFrontmatter(data, markdown);
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Get timing config from campaign settings with defaults.
   */
  getTimingConfig(settings: CampaignSettings): {
    response_delay_min_hours: number;
    response_delay_max_hours: number;
    business_hours_only: boolean;
    business_hours_start: string;
    business_hours_end: string;
    business_hours_timezone: string;
    response_mode: ResponseMode;
  } {
    return {
      response_delay_min_hours:
        settings.response_delay_min_hours ?? DEFAULT_CAMPAIGN_TIMING.response_delay_min_hours,
      response_delay_max_hours:
        settings.response_delay_max_hours ?? DEFAULT_CAMPAIGN_TIMING.response_delay_max_hours,
      business_hours_only:
        settings.business_hours_only ?? DEFAULT_CAMPAIGN_TIMING.business_hours_only,
      business_hours_start:
        settings.business_hours_start ?? DEFAULT_CAMPAIGN_TIMING.business_hours_start,
      business_hours_end:
        settings.business_hours_end ?? DEFAULT_CAMPAIGN_TIMING.business_hours_end,
      business_hours_timezone:
        settings.business_hours_timezone ?? DEFAULT_CAMPAIGN_TIMING.business_hours_timezone,
      response_mode: settings.response_mode ?? DEFAULT_CAMPAIGN_TIMING.response_mode,
    };
  }

  /**
   * Create a new campaign.
   */
  async createCampaign(
    tenantId: string,
    name: string,
    ownerPhone: string,
    goal: string,
    audience?: Partial<CampaignAudience>
  ): Promise<Campaign> {
    const campaignFolder = this.getCampaignFolder(tenantId, name);

    // Check if campaign already exists
    if (fs.existsSync(campaignFolder)) {
      throw new Error(`Campaign "${name}" already exists`);
    }

    // Create campaign folder
    await fs.promises.mkdir(campaignFolder, { recursive: true });

    const now = new Date().toISOString();
    const campaignId = randomUUID();

    // Create config.md
    const config: CampaignConfig = {
      version: 1,
      id: campaignId,
      name,
      status: 'draft',
      created_at: now,
      lastUpdated: now,
      owner_phone: ownerPhone,
      goal,
      audience: {
        description: audience?.description ?? '',
        industries: audience?.industries ?? [],
        company_size: audience?.company_size ?? '',
        locations: audience?.locations ?? [],
      },
      channels: {
        email: { enabled: true, provider: 'gmail' },
        linkedin: { enabled: false },
        sms: { enabled: false },
        calls: { enabled: false },
      },
      settings: {
        max_daily_outreach: 20,
        min_days_between_touches: 3,
        max_touches_per_target: 5,
        require_approval: true,
        approval_mode: 'batch',
        // Timing settings with defaults
        response_delay_min_hours: DEFAULT_CAMPAIGN_TIMING.response_delay_min_hours,
        response_delay_max_hours: DEFAULT_CAMPAIGN_TIMING.response_delay_max_hours,
        business_hours_only: DEFAULT_CAMPAIGN_TIMING.business_hours_only,
        business_hours_start: DEFAULT_CAMPAIGN_TIMING.business_hours_start,
        business_hours_end: DEFAULT_CAMPAIGN_TIMING.business_hours_end,
        business_hours_timezone: DEFAULT_CAMPAIGN_TIMING.business_hours_timezone,
        response_mode: DEFAULT_CAMPAIGN_TIMING.response_mode,
      },
      metrics_snapshot: {
        total_targets: 0,
        by_stage: {
          identified: 0,
          researched: 0,
          contacted: 0,
          replied: 0,
          qualified: 0,
          booked: 0,
          won: 0,
          lost: 0,
        },
      },
    };

    const configMarkdown = `# Campaign: ${name}

## Objective
${goal}

## Messaging Guidelines
- Personalize every message based on research
- Keep messages concise and value-focused
- Reference specific company news or achievements

## Notes
`;

    await this.writeCampaignFile(
      path.join(campaignFolder, 'config.md'),
      config,
      configMarkdown
    );

    // Create targets.md with new reference format
    const targets: TargetReferencesData = {
      version: 2, // Version 2 uses target_references
      lastUpdated: now,
      target_references: [],
    };

    const targetsMarkdown = `# Campaign Targets

## Stage Definitions
- **Identified**: Added to campaign, not yet researched
- **Researched**: Background research completed
- **Contacted**: At least one outreach attempt made
- **Replied**: Received any response (positive or negative)
- **Qualified**: Confirmed interest/fit
- **Booked**: Meeting scheduled
- **Won**: Deal closed
- **Lost**: Declined or unsubscribed
`;

    await this.writeCampaignFile(
      path.join(campaignFolder, 'targets.md'),
      targets,
      targetsMarkdown
    );

    // Create sequence.md
    const sequence = {
      version: 1,
      lastUpdated: now,
      ai_instructions: {
        mode: 'autonomous',
        guidelines: [
          'Personalize every message based on research',
          'Reference specific company news or achievements',
          'Keep messages under 150 words for email',
          'Wait at least 3 days between touches',
          'Vary channels if no response',
        ],
        tone: 'professional but conversational',
        forbidden_phrases: ['touching base', 'just checking in', 'circle back'],
      },
    };

    const sequenceMarkdown = `# Sequence Strategy

## AI Decision Guidelines
The AI should analyze each target's context and decide the best next action.

## Channel Priority
1. Email (primary)
2. LinkedIn (if connected or can connect)
3. SMS (only for warm leads with phone)
4. Calls (only for qualified leads)
`;

    await this.writeCampaignFile(
      path.join(campaignFolder, 'sequence.md'),
      sequence,
      sequenceMarkdown
    );

    // Create metrics.md
    const metrics = {
      version: 1,
      lastUpdated: now,
      summary: {
        total_targets: 0,
        total_touches: 0,
        total_replies: 0,
        meetings_booked: 0,
        deals_won: 0,
        deals_lost: 0,
      },
      by_stage: config.metrics_snapshot.by_stage,
      by_channel: {
        email: { sent: 0, opened: 0, replied: 0 },
        linkedin: { sent: 0, accepted: 0, replied: 0 },
        sms: { sent: 0, replied: 0 },
        calls: { made: 0, answered: 0, booked: 0 },
      },
      daily_stats: [],
    };

    const metricsMarkdown = `# Campaign Metrics

## Performance Summary
Last updated: ${now}
`;

    await this.writeCampaignFile(
      path.join(campaignFolder, 'metrics.md'),
      metrics,
      metricsMarkdown
    );

    // Create log.md
    const log = {
      version: 1,
      lastUpdated: now,
    };

    const logMarkdown = `# Campaign Activity Log

## ${now.split('T')[0]}

### ${now.split('T')[1].split('.')[0]} [CAMPAIGN] Campaign created
- Name: ${name}
- Goal: ${goal}
- Status: draft

`;

    await this.writeCampaignFile(
      path.join(campaignFolder, 'log.md'),
      log,
      logMarkdown
    );

    logger.info({ tenantId, campaignId, name }, 'Campaign created');

    return {
      id: campaignId,
      name,
      status: 'draft',
      config,
      targetsCount: 0,
    };
  }

  /**
   * Get a campaign by name.
   */
  async getCampaign(tenantId: string, campaignName: string): Promise<Campaign | null> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);

    if (!fs.existsSync(campaignFolder)) {
      return null;
    }

    try {
      const { data: config } = await this.readCampaignFile<CampaignConfig>(
        path.join(campaignFolder, 'config.md')
      );

      // Read targets and get count (handle both old and new format)
      const targetsPath = path.join(campaignFolder, 'targets.md');
      const content = await fs.promises.readFile(targetsPath, 'utf-8');
      const { data: targetsData } = this.parseFrontmatter<Record<string, unknown>>(content);

      let targetsCount = 0;
      if (targetsData.target_references) {
        targetsCount = (targetsData.target_references as TargetReference[]).length;
      } else if (targetsData.targets) {
        targetsCount = (targetsData.targets as Target[]).length;
      }

      return {
        id: config.id,
        name: config.name,
        status: config.status,
        config,
        targetsCount,
      };
    } catch (error) {
      logger.error({ tenantId, campaignName, error }, 'Failed to read campaign');
      return null;
    }
  }

  /**
   * List all campaigns for a tenant.
   */
  async listCampaigns(tenantId: string): Promise<Campaign[]> {
    const campaignsFolder = this.getCampaignsFolder(tenantId);

    if (!fs.existsSync(campaignsFolder)) {
      return [];
    }

    const campaigns: Campaign[] = [];
    const entries = await fs.promises.readdir(campaignsFolder, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const campaign = await this.getCampaign(tenantId, entry.name);
        if (campaign) {
          campaigns.push(campaign);
        }
      }
    }

    return campaigns;
  }

  /**
   * Update campaign configuration.
   */
  async updateCampaign(
    tenantId: string,
    campaignName: string,
    updates: Partial<CampaignConfig>
  ): Promise<Campaign> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const configPath = path.join(campaignFolder, 'config.md');

    if (!fs.existsSync(configPath)) {
      throw new Error(`Campaign "${campaignName}" not found`);
    }

    const { data: config, markdown } = await this.readCampaignFile<CampaignConfig>(configPath);

    // Apply updates
    const updatedConfig: CampaignConfig = {
      ...config,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };

    await this.writeCampaignFile(configPath, updatedConfig, markdown);

    // Log status change
    if (updates.status && updates.status !== config.status) {
      await this.logCampaignEvent(
        tenantId,
        campaignName,
        'STATUS_CHANGE',
        `Status changed: ${config.status} → ${updates.status}`
      );
    }

    logger.info({ tenantId, campaignName, updates }, 'Campaign updated');

    return {
      id: updatedConfig.id,
      name: updatedConfig.name,
      status: updatedConfig.status,
      config: updatedConfig,
      targetsCount: updatedConfig.metrics_snapshot.total_targets,
    };
  }

  /**
   * Pause a campaign.
   */
  async pauseCampaign(tenantId: string, campaignName: string): Promise<void> {
    await this.updateCampaign(tenantId, campaignName, { status: 'paused' });
  }

  /**
   * Resume/activate a campaign.
   */
  async activateCampaign(tenantId: string, campaignName: string): Promise<void> {
    await this.updateCampaign(tenantId, campaignName, { status: 'active' });
  }

  /**
   * Add a target to a campaign using prospect slug (NEW method).
   * Creates a reference to the prospect file instead of storing inline data.
   */
  async addTargetByProspectSlug(
    tenantId: string,
    campaignName: string,
    prospectSlug: string
  ): Promise<TargetReference> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    if (!fs.existsSync(targetsPath)) {
      throw new Error(`Campaign "${campaignName}" not found`);
    }

    const content = await fs.promises.readFile(targetsPath, 'utf-8');
    const { data: rawData, markdown } = this.parseFrontmatter<Record<string, unknown>>(content);

    const now = new Date().toISOString();

    // Create new target reference
    const newReference: TargetReference = {
      id: randomUUID(),
      prospect_slug: prospectSlug,
      added_at: now,
      last_touch_at: null,
      touch_count: 0,
      campaign_stage: 'identified',
      unsubscribed: false,
    };

    // Handle both old and new format
    let targetReferences: TargetReference[];
    if (rawData.target_references) {
      targetReferences = rawData.target_references as TargetReference[];
    } else {
      // Initialize new format
      targetReferences = [];
    }

    targetReferences.push(newReference);

    const updatedData: TargetReferencesData = {
      version: 2,
      lastUpdated: now,
      target_references: targetReferences,
    };

    await this.writeCampaignFile(targetsPath, updatedData, markdown);

    // Update metrics
    await this.updateMetricsFromReferences(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'TARGET_ADDED',
      `Added target reference: ${prospectSlug}`
    );

    logger.debug({ tenantId, campaignName, prospectSlug, targetId: newReference.id }, 'Target reference added');

    return newReference;
  }

  /**
   * Get target references for a campaign (NEW method).
   */
  async getTargetReferences(tenantId: string, campaignName: string): Promise<TargetReference[]> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    if (!fs.existsSync(targetsPath)) {
      return [];
    }

    const content = await fs.promises.readFile(targetsPath, 'utf-8');
    const { data: rawData } = this.parseFrontmatter<Record<string, unknown>>(content);

    if (rawData.target_references) {
      return rawData.target_references as TargetReference[];
    }

    return [];
  }

  /**
   * Get a target with full prospect context (NEW method).
   * Loads both the target reference and the associated prospect file.
   */
  async getTargetWithContext(
    tenantId: string,
    campaignName: string,
    targetId: string,
    prospectService?: ProspectService
  ): Promise<TargetWithContext> {
    const references = await this.getTargetReferences(tenantId, campaignName);
    const target = references.find(r => r.id === targetId);

    if (!target) {
      throw new Error(`Target "${targetId}" not found`);
    }

    let prospect: ProspectData | null = null;
    if (prospectService) {
      prospect = await prospectService.readProspect(tenantId, target.prospect_slug);
    } else {
      // Create a temporary service if not provided
      const tempService = new ProspectService(this.projectRoot);
      prospect = await tempService.readProspect(tenantId, target.prospect_slug);
    }

    return { target, prospect };
  }

  /**
   * Update target stage and sync to prospect file (NEW method).
   */
  async updateTargetStageWithSync(
    tenantId: string,
    campaignName: string,
    targetId: string,
    newStage: CampaignStage,
    prospectService: ProspectService
  ): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    const content = await fs.promises.readFile(targetsPath, 'utf-8');
    const { data: rawData, markdown } = this.parseFrontmatter<Record<string, unknown>>(content);

    if (!rawData.target_references) {
      throw new Error('Campaign uses old format - cannot sync stages');
    }

    const references = rawData.target_references as TargetReference[];
    const target = references.find(r => r.id === targetId);

    if (!target) {
      throw new Error(`Target "${targetId}" not found`);
    }

    const oldStage = target.campaign_stage;
    target.campaign_stage = newStage;

    const now = new Date().toISOString();

    const updatedData: TargetReferencesData = {
      version: 2,
      lastUpdated: now,
      target_references: references,
    };

    await this.writeCampaignFile(targetsPath, updatedData, markdown);

    // Sync stage to prospect file
    await prospectService.updateProspect(tenantId, target.prospect_slug, {
      stage: newStage as ProspectStage,
    });

    // Update metrics
    await this.updateMetricsFromReferences(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'STAGE_CHANGE',
      `${target.prospect_slug}: ${oldStage} → ${newStage}`
    );

    logger.debug({ tenantId, campaignName, targetId, oldStage, newStage }, 'Target stage updated and synced');
  }

  /**
   * Remove a target from a campaign (preserves prospect file).
   */
  async removeTarget(tenantId: string, campaignName: string, targetId: string): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    const content = await fs.promises.readFile(targetsPath, 'utf-8');
    const { data: rawData, markdown } = this.parseFrontmatter<Record<string, unknown>>(content);

    if (!rawData.target_references) {
      throw new Error('Campaign uses old format - use legacy methods');
    }

    const references = rawData.target_references as TargetReference[];
    const targetIndex = references.findIndex(r => r.id === targetId);

    if (targetIndex === -1) {
      throw new Error(`Target "${targetId}" not found`);
    }

    const removedTarget = references[targetIndex];
    references.splice(targetIndex, 1);

    const now = new Date().toISOString();

    const updatedData: TargetReferencesData = {
      version: 2,
      lastUpdated: now,
      target_references: references,
    };

    await this.writeCampaignFile(targetsPath, updatedData, markdown);

    // Update metrics
    await this.updateMetricsFromReferences(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'TARGET_REMOVED',
      `Removed target reference: ${removedTarget.prospect_slug}`
    );

    logger.debug({ tenantId, campaignName, targetId }, 'Target removed from campaign');
  }

  /**
   * Update metrics from target references.
   */
  private async updateMetricsFromReferences(tenantId: string, campaignName: string): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const configPath = path.join(campaignFolder, 'config.md');
    const metricsPath = path.join(campaignFolder, 'metrics.md');

    const references = await this.getTargetReferences(tenantId, campaignName);

    const { data: config, markdown: configMarkdown } =
      await this.readCampaignFile<CampaignConfig>(configPath);
    const { data: metrics, markdown: metricsMarkdown } =
      await this.readCampaignFile<Record<string, unknown>>(metricsPath);

    // Calculate stage counts
    const byStage: Record<CampaignStage, number> = {
      identified: 0,
      researched: 0,
      contacted: 0,
      replied: 0,
      qualified: 0,
      booked: 0,
      won: 0,
      lost: 0,
    };

    let totalTouches = 0;
    let totalReplies = 0;

    for (const ref of references) {
      byStage[ref.campaign_stage]++;
      totalTouches += ref.touch_count;
      if (ref.campaign_stage === 'replied' || ref.campaign_stage === 'qualified' ||
          ref.campaign_stage === 'booked' || ref.campaign_stage === 'won') {
        totalReplies++;
      }
    }

    // Update config metrics snapshot
    config.metrics_snapshot = {
      total_targets: references.length,
      by_stage: byStage,
    };
    config.lastUpdated = new Date().toISOString();
    await this.writeCampaignFile(configPath, config, configMarkdown);

    // Update metrics file
    (metrics as Record<string, unknown>).summary = {
      total_targets: references.length,
      total_touches: totalTouches,
      total_replies: totalReplies,
      meetings_booked: byStage.booked + byStage.won,
      deals_won: byStage.won,
      deals_lost: byStage.lost,
    };
    (metrics as Record<string, unknown>).by_stage = byStage;
    (metrics as Record<string, unknown>).lastUpdated = config.lastUpdated;

    await this.writeCampaignFile(metricsPath, metrics, metricsMarkdown);
  }

  // ============ LEGACY METHODS (for backward compatibility) ============

  /**
   * Add a target to a campaign (LEGACY - inline data).
   * Kept for backward compatibility with old campaigns.
   */
  async addTarget(
    tenantId: string,
    campaignName: string,
    target: Omit<Target, 'id' | 'touches' | 'unsubscribed' | 'created_at' | 'stage_changed_at'>
  ): Promise<Target> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    if (!fs.existsSync(targetsPath)) {
      throw new Error(`Campaign "${campaignName}" not found`);
    }

    const { data: targetsData, markdown } = await this.readCampaignFile<TargetsData>(targetsPath);

    const now = new Date().toISOString();
    const newTarget: Target = {
      id: randomUUID(),
      stage: target.stage ?? 'identified',
      name: target.name,
      title: target.title,
      company: target.company,
      email: target.email,
      linkedin: target.linkedin,
      phone: target.phone,
      research: target.research,
      touches: [],
      next_action: target.next_action,
      unsubscribed: false,
      created_at: now,
      stage_changed_at: now,
    };

    targetsData.targets.push(newTarget);
    targetsData.lastUpdated = now;

    await this.writeCampaignFile(targetsPath, targetsData, markdown);

    // Update metrics
    await this.updateMetrics(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'TARGET_ADDED',
      `Added target: ${newTarget.name} (${newTarget.email ?? 'no email'})`
    );

    logger.debug({ tenantId, campaignName, targetId: newTarget.id }, 'Target added');

    return newTarget;
  }

  /**
   * Update a target's stage (LEGACY).
   */
  async updateTargetStage(
    tenantId: string,
    campaignName: string,
    targetId: string,
    newStage: CampaignStage
  ): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    const { data: targetsData, markdown } = await this.readCampaignFile<TargetsData>(targetsPath);

    const target = targetsData.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new Error(`Target "${targetId}" not found`);
    }

    const oldStage = target.stage;
    target.stage = newStage;
    target.stage_changed_at = new Date().toISOString();
    targetsData.lastUpdated = target.stage_changed_at;

    await this.writeCampaignFile(targetsPath, targetsData, markdown);

    // Update metrics
    await this.updateMetrics(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'STAGE_CHANGE',
      `${target.name}: ${oldStage} → ${newStage}`
    );

    logger.debug({ tenantId, campaignName, targetId, oldStage, newStage }, 'Target stage updated');
  }

  /**
   * Record a touch (outreach attempt) for a target (LEGACY).
   */
  async recordTouch(
    tenantId: string,
    campaignName: string,
    targetId: string,
    touch: Omit<TargetTouch, 'id'>
  ): Promise<TargetTouch> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    const { data: targetsData, markdown } = await this.readCampaignFile<TargetsData>(targetsPath);

    const target = targetsData.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new Error(`Target "${targetId}" not found`);
    }

    const newTouch: TargetTouch = {
      id: randomUUID(),
      ...touch,
    };

    target.touches.push(newTouch);
    targetsData.lastUpdated = new Date().toISOString();

    // Update stage to contacted if this is first touch
    if (target.stage === 'identified' || target.stage === 'researched') {
      target.stage = 'contacted';
      target.stage_changed_at = targetsData.lastUpdated;
    }

    await this.writeCampaignFile(targetsPath, targetsData, markdown);

    // Update metrics
    await this.updateMetrics(tenantId, campaignName);

    return newTouch;
  }

  /**
   * Get all targets for a campaign (LEGACY - reads old format).
   */
  async getTargets(tenantId: string, campaignName: string): Promise<TargetsData | null> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    if (!fs.existsSync(targetsPath)) {
      return null;
    }

    const content = await fs.promises.readFile(targetsPath, 'utf-8');
    const { data: rawData } = this.parseFrontmatter<Record<string, unknown>>(content);

    // Handle old format
    if (rawData.targets) {
      return {
        version: (rawData.version as number) || 1,
        lastUpdated: (rawData.lastUpdated as string) || new Date().toISOString(),
        targets: rawData.targets as Target[],
      };
    }

    // New format - return empty targets for backward compatibility
    return {
      version: 1,
      lastUpdated: (rawData.lastUpdated as string) || new Date().toISOString(),
      targets: [],
    };
  }

  /**
   * Get targets that need processing (LEGACY).
   */
  async getTargetsForProcessing(tenantId: string, campaignName: string): Promise<Target[]> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const configPath = path.join(campaignFolder, 'config.md');
    const targetsPath = path.join(campaignFolder, 'targets.md');

    if (!fs.existsSync(configPath) || !fs.existsSync(targetsPath)) {
      return [];
    }

    const { data: config } = await this.readCampaignFile<CampaignConfig>(configPath);

    // Only process active campaigns
    if (config.status !== 'active') {
      return [];
    }

    const targetsData = await this.getTargets(tenantId, campaignName);
    if (!targetsData) {
      return [];
    }

    const now = new Date();
    const minDaysBetween = config.settings.min_days_between_touches;
    const maxTouches = config.settings.max_touches_per_target;

    return targetsData.targets.filter((target) => {
      // Skip unsubscribed
      if (target.unsubscribed) return false;

      // Skip won/lost
      if (target.stage === 'won' || target.stage === 'lost') return false;

      // Skip if max touches reached
      if (target.touches.length >= maxTouches) return false;

      // Check min days between touches
      if (target.touches.length > 0) {
        const lastTouch = target.touches[target.touches.length - 1];
        const lastTouchDate = new Date(lastTouch.sent_at);
        const daysSinceTouch = (now.getTime() - lastTouchDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceTouch < minDaysBetween) return false;
      }

      return true;
    });
  }

  /**
   * Update campaign metrics (LEGACY).
   */
  async updateMetrics(tenantId: string, campaignName: string): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const configPath = path.join(campaignFolder, 'config.md');
    const targetsPath = path.join(campaignFolder, 'targets.md');
    const metricsPath = path.join(campaignFolder, 'metrics.md');

    const targetsData = await this.getTargets(tenantId, campaignName);
    if (!targetsData) {
      return;
    }

    const { data: config, markdown: configMarkdown } =
      await this.readCampaignFile<CampaignConfig>(configPath);
    const { data: metrics, markdown: metricsMarkdown } =
      await this.readCampaignFile<Record<string, unknown>>(metricsPath);

    // Calculate stage counts
    const byStage: Record<CampaignStage, number> = {
      identified: 0,
      researched: 0,
      contacted: 0,
      replied: 0,
      qualified: 0,
      booked: 0,
      won: 0,
      lost: 0,
    };

    let totalTouches = 0;
    let totalReplies = 0;

    for (const target of targetsData.targets) {
      byStage[target.stage]++;
      totalTouches += target.touches.length;
      if (target.stage === 'replied' || target.stage === 'qualified' || target.stage === 'booked' || target.stage === 'won') {
        totalReplies++;
      }
    }

    // Update config metrics snapshot
    config.metrics_snapshot = {
      total_targets: targetsData.targets.length,
      by_stage: byStage,
    };
    config.lastUpdated = new Date().toISOString();
    await this.writeCampaignFile(configPath, config, configMarkdown);

    // Update metrics file
    (metrics as Record<string, unknown>).summary = {
      total_targets: targetsData.targets.length,
      total_touches: totalTouches,
      total_replies: totalReplies,
      meetings_booked: byStage.booked + byStage.won,
      deals_won: byStage.won,
      deals_lost: byStage.lost,
    };
    (metrics as Record<string, unknown>).by_stage = byStage;
    (metrics as Record<string, unknown>).lastUpdated = config.lastUpdated;

    await this.writeCampaignFile(metricsPath, metrics, metricsMarkdown);
  }

  /**
   * Log an event to the campaign log.
   */
  async logCampaignEvent(
    tenantId: string,
    campaignName: string,
    eventType: string,
    message: string
  ): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const logPath = path.join(campaignFolder, 'log.md');

    if (!fs.existsSync(logPath)) {
      return;
    }

    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toISOString().split('T')[1].split('.')[0];

      const entry = `### ${timeStr} [${eventType}] ${message}\n\n`;

      const content = await fs.promises.readFile(logPath, 'utf-8');

      // Check if today's date header exists
      if (!content.includes(`## ${dateStr}`)) {
        // Add new date header
        const newContent = content + `\n## ${dateStr}\n\n${entry}`;
        await fs.promises.writeFile(logPath, newContent, 'utf-8');
      } else {
        // Append to existing date section
        const parts = content.split(`## ${dateStr}`);
        const newContent = parts[0] + `## ${dateStr}\n\n${entry}` + parts[1].substring(parts[1].indexOf('\n\n') + 2);
        await fs.promises.writeFile(logPath, newContent, 'utf-8');
      }
    } catch (error) {
      logger.error({ tenantId, campaignName, error }, 'Failed to log campaign event');
    }
  }

  /**
   * Mark a target as unsubscribed (LEGACY).
   */
  async markUnsubscribed(tenantId: string, campaignName: string, targetId: string): Promise<void> {
    const campaignFolder = this.getCampaignFolder(tenantId, campaignName);
    const targetsPath = path.join(campaignFolder, 'targets.md');

    const { data: targetsData, markdown } = await this.readCampaignFile<TargetsData>(targetsPath);

    const target = targetsData.targets.find((t) => t.id === targetId);
    if (!target) {
      throw new Error(`Target "${targetId}" not found`);
    }

    target.unsubscribed = true;
    target.stage = 'lost';
    target.stage_changed_at = new Date().toISOString();
    targetsData.lastUpdated = target.stage_changed_at;

    await this.writeCampaignFile(targetsPath, targetsData, markdown);

    // Update metrics
    await this.updateMetrics(tenantId, campaignName);

    // Log event
    await this.logCampaignEvent(
      tenantId,
      campaignName,
      'UNSUBSCRIBE',
      `${target.name} unsubscribed`
    );
  }
}
