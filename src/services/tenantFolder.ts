import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';
import { getPrismaClient } from './prisma.js';

/**
 * TenantFolderService handles tenant folder setup and initialization
 * for Claude CLI mode.
 */
export class TenantFolderService {
  private projectRoot: string;
  // Cache of initialized tenants to avoid redundant I/O
  private initializedTenants: Set<string> = new Set();

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Clear the initialization cache (useful for testing or after config changes).
   */
  clearCache(): void {
    this.initializedTenants.clear();
  }

  /**
   * Refresh a specific tenant's config by invalidating their cache entry.
   * This forces re-initialization (including CLAUDE.md regeneration) on next message.
   */
  refreshTenantConfig(tenantId: string): void {
    this.initializedTenants.delete(tenantId);
    logger.info({ tenantId }, 'Tenant config cache invalidated');
  }

  /**
   * Get the absolute path to a tenant's folder.
   * @throws Error if tenant ID is invalid (path traversal prevention)
   */
  getTenantFolder(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId);
  }

  /**
   * Check if a tenant folder exists.
   */
  async tenantFolderExists(tenantId: string): Promise<boolean> {
    const tenantFolder = this.getTenantFolder(tenantId);
    return fs.existsSync(tenantFolder);
  }

  /**
   * Ensure CLAUDE.md exists in the tenant folder.
   *
   * SYSTEM PROMPT HIERARCHY:
   * 1. tenants/{id}/directives/README.md  - PRIMARY source (per-tenant customization)
   * 2. src/templates/CLAUDE.md            - FALLBACK template (used if no directives/README.md)
   *
   * Flow: Reads directives/README.md → appends WhatsApp instructions → writes CLAUDE.md
   * The generated CLAUDE.md is what Claude CLI reads, but directives/README.md is the source.
   *
   * To update system prompt:
   * - For ALL tenants: Edit src/templates/CLAUDE.md
   * - For ONE tenant: Edit their tenants/{id}/directives/README.md
   */
  async ensureClaudeMd(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const claudeMdPath = path.join(tenantFolder, 'CLAUDE.md');
    const directivesPath = path.join(tenantFolder, 'directives', 'README.md');
    const templatePath = path.join(this.projectRoot, 'src', 'templates', 'CLAUDE.md');

    // Try to read from directives/README.md first
    try {
      const directivesContent = await fs.promises.readFile(directivesPath, 'utf-8');
      // Generate CLAUDE.md with directives content and WhatsApp instructions
      const whatsappInstructions = `

## WhatsApp Communication Guidelines
- Keep messages concise and mobile-friendly
- Use simple formatting that works in WhatsApp
- Be responsive and helpful
`;
      const generatedContent = directivesContent + whatsappInstructions;
      await fs.promises.writeFile(claudeMdPath, generatedContent, 'utf-8');
      logger.info({ tenantId, claudeMdPath }, 'Generated CLAUDE.md from directives');
      return;
    } catch {
      // directives/README.md doesn't exist, try template
    }

    // Try to copy from static template
    try {
      await fs.promises.copyFile(templatePath, claudeMdPath);
      logger.info({ tenantId, claudeMdPath }, 'Copied static CLAUDE.md template');
    } catch (error) {
      // Template missing - create minimal default
      logger.error({ tenantId, templatePath, error }, 'Failed to copy CLAUDE.md template');
      const defaultContent = `# CLAUDE.md

This file provides guidance to Claude Code when working in this tenant folder.

## Guidelines
- Follow user instructions carefully
- Be helpful and concise
`;
      await fs.promises.writeFile(claudeMdPath, defaultContent, 'utf-8');
      logger.info({ tenantId, claudeMdPath }, 'Created default CLAUDE.md');
    }
  }

  /**
   * Ensure life/ folder structure exists for permanent memory storage.
   */
  async ensureLifeFolder(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const lifeDir = path.join(tenantFolder, 'life');

    // Create main life directory and subdirectories
    const directories = [
      lifeDir,
      path.join(lifeDir, 'knowledge'),
      path.join(lifeDir, 'events'),
      path.join(lifeDir, 'relationships'),
    ];

    for (const dir of directories) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Create template files with JSON frontmatter if they don't exist
    const now = new Date().toISOString();
    const templateFiles: Array<{ path: string; content: string }> = [
      {
        path: path.join(lifeDir, 'identity.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "name": "",
  "timezone": "",
  "preferences": {
    "communicationStyle": "concise",
    "responseLength": "short"
  }
}
---
# Identity

Additional context and notes about this tenant.
`,
      },
      {
        path: path.join(lifeDir, 'boundaries.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "neverDo": [
    "Share credentials or API keys",
    "Make purchases without explicit confirmation",
    "Delete data without confirmation"
  ],
  "alwaysDo": [
    "Confirm before any financial transaction",
    "Log significant decisions"
  ],
  "escalateWhen": [
    "Request involves money over $100",
    "Request seems to conflict with previous instructions",
    "Uncertainty about appropriate action"
  ],
  "limits": {
    "maxResponseChars": 500
  }
}
---
# Boundaries

Hard rules that govern agent behavior. These are non-negotiable.
`,
      },
      {
        path: path.join(lifeDir, 'patterns.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "lastAnalyzed": "${now}",
  "communication": [],
  "work": [],
  "temporal": []
}
---
# Observed Patterns

Patterns are automatically learned from conversations.
`,
      },
      {
        path: path.join(lifeDir, 'questions.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "pending": [
    {"id": "q1", "question": "What should I call you?", "priority": "high"},
    {"id": "q2", "question": "What do you do / what's your business?", "priority": "high"},
    {"id": "q3", "question": "What timezone are you in?", "priority": "medium"}
  ],
  "answered": []
}
---
# Discovery Questions

Questions to ask during onboarding and ongoing discovery.
`,
      },
      {
        path: path.join(lifeDir, 'knowledge', 'business.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "industry": "",
  "description": "",
  "services": [],
  "facts": []
}
---
# Business Context

Information about the tenant's business.
`,
      },
      {
        path: path.join(lifeDir, 'knowledge', 'contacts.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "contacts": []
}
---
# Key Contacts

Important people and their roles.
`,
      },
      {
        path: path.join(lifeDir, 'knowledge', 'procedures.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "procedures": []
}
---
# Procedures

How the tenant likes things done.
`,
      },
      {
        path: path.join(lifeDir, 'relationships', 'people.md'),
        content: `---json
{
  "version": 1,
  "lastUpdated": "${now}",
  "people": []
}
---
# Relationship Map

People, connections, and context.
`,
      },
    ];

    for (const template of templateFiles) {
      try {
        // Only create if file doesn't exist (don't overwrite)
        await fs.promises.access(template.path);
        logger.debug({ tenantId, path: template.path }, 'Life file already exists, skipping');
      } catch {
        // File doesn't exist, create it
        await fs.promises.writeFile(template.path, template.content, 'utf-8');
        logger.info({ tenantId, path: template.path }, 'Created life template file');
      }
    }

    logger.info({ tenantId, lifeDir }, 'Life folder structure ensured');
  }

  /**
   * Ensure state/ folder exists with runtime state JSON files.
   */
  async ensureStateFolder(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const stateDir = path.join(tenantFolder, 'state');

    // Create state directory
    await fs.promises.mkdir(stateDir, { recursive: true });

    // Template files for state folder
    const stateFiles: Array<{ name: string; content: object }> = [
      {
        name: 'current.json',
        content: {
          lastUpdated: new Date().toISOString(),
          activeTasks: [],
          priorities: [],
          blockers: [],
        },
      },
      {
        name: 'clients.json',
        content: {
          lastUpdated: new Date().toISOString(),
          relationships: [],
        },
      },
      {
        name: 'calendar.json',
        content: {
          lastUpdated: new Date().toISOString(),
          timezone: 'America/Denver',
          workingHours: {
            start: '09:00',
            end: '17:00',
            days: [1, 2, 3, 4, 5],
          },
          busySlots: [],
          nextAvailable: null,
        },
      },
    ];

    for (const file of stateFiles) {
      const filePath = path.join(stateDir, file.name);
      try {
        await fs.promises.access(filePath);
        logger.debug({ tenantId, path: filePath }, 'State file already exists, skipping');
      } catch {
        await fs.promises.writeFile(filePath, JSON.stringify(file.content, null, 2), 'utf-8');
        logger.info({ tenantId, path: filePath }, 'Created state file');
      }
    }

    logger.info({ tenantId, stateDir }, 'State folder structure ensured');
  }

  /**
   * Ensure history/ folder exists with decisions.log file.
   */
  async ensureHistoryFolder(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const historyDir = path.join(tenantFolder, 'history');

    // Create history directory
    await fs.promises.mkdir(historyDir, { recursive: true });

    // Create decisions.log with header
    const decisionsLog = path.join(historyDir, 'decisions.log');
    try {
      await fs.promises.access(decisionsLog);
      logger.debug({ tenantId, path: decisionsLog }, 'decisions.log already exists, skipping');
    } catch {
      const header = `# Decision Log
# Format: [TIMESTAMP] [CATEGORY] Decision description
# Categories: ACTION, ESCALATION, BOUNDARY, STATE_CHANGE

`;
      await fs.promises.writeFile(decisionsLog, header, 'utf-8');
      logger.info({ tenantId, path: decisionsLog }, 'Created decisions.log');
    }

    logger.info({ tenantId, historyDir }, 'History folder structure ensured');
  }

  /**
   * Ensure boundaries.md exists in life/ folder.
   */
  async ensureBoundariesFile(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const boundariesPath = path.join(tenantFolder, 'life', 'boundaries.md');

    try {
      await fs.promises.access(boundariesPath);
      logger.debug({ tenantId, path: boundariesPath }, 'boundaries.md already exists, skipping');
    } catch {
      const content = `# Boundaries

Hard rules that govern agent behavior. These are non-negotiable.

## Never Do
- Never share credentials or API keys
- Never make purchases without explicit confirmation
- Never delete data without confirmation
- Never send emails/messages on behalf without approval

## Always Do
- Always confirm before any financial transaction
- Always log significant decisions to history/decisions.log
- Always check state/current.json before starting new tasks
- Always respect working hours in state/calendar.json

## Escalate When
- Request involves money over $100
- Request seems to conflict with previous instructions
- User appears distressed or mentions emergencies
- Uncertainty about appropriate action

## Response Limits
- Maximum 500 characters for WhatsApp
- No markdown formatting (no **bold**, no \`code\`)
- 2-3 sentences maximum
`;
      await fs.promises.writeFile(boundariesPath, content, 'utf-8');
      logger.info({ tenantId, path: boundariesPath }, 'Created boundaries.md');
    }
  }

  /**
   * Generate .claude/settings.local.json with required permissions and MCP server config.
   */
  async generateSettingsJson(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const claudeDir = path.join(tenantFolder, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    // Ensure .claude directory exists
    await fs.promises.mkdir(claudeDir, { recursive: true });

    // Build permissions array (includes MCP tools permission)
    const permissions = [
      'Bash(python execution/*.py:*)',
      'Bash(python shared_tools/*.py:*)',
      'WebFetch(*)',
      'Read(*)',
      'Write(*)',
      'Glob(*)',
      'Grep(*)',
      'mcp__tools__*',
    ];

    const settings = {
      permissions: {
        allow: permissions,
      },
      mcpServers: {
        tools: {
          command: 'npx',
          args: ['tsx', '../../src/mcp/toolManifestServer.ts'],
          env: {
            TENANT_FOLDER: '.',
          },
        },
      },
    };

    // Write settings file
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info({ tenantId, settingsPath }, 'Generated .claude/settings.local.json');
  }

  /**
   * Set up shared_tools directory with symlinks to shared Python scripts.
   */
  async setupSharedTools(tenantId: string): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const sharedToolsDir = path.join(tenantFolder, 'shared_tools');
    const sourceToolsDir = path.join(this.projectRoot, 'src', 'tools', 'python');

    // Create shared_tools directory
    await fs.promises.mkdir(sharedToolsDir, { recursive: true });
    logger.info({ tenantId, sharedToolsDir }, 'Created shared_tools directory');

    // Check if source directory exists
    if (!fs.existsSync(sourceToolsDir)) {
      logger.warn(
        { tenantId, sourceToolsDir },
        'Shared tools source directory does not exist, skipping symlink creation'
      );
      return;
    }

    // Get list of Python scripts to symlink
    let sourceFiles: string[];
    try {
      sourceFiles = await fs.promises.readdir(sourceToolsDir);
    } catch {
      logger.warn({ tenantId, sourceToolsDir }, 'Could not read shared tools source directory');
      return;
    }

    const pythonScripts = sourceFiles.filter(f => f.endsWith('.py'));

    // Create symlinks for each script
    for (const script of pythonScripts) {
      const sourcePath = path.join(sourceToolsDir, script);
      const targetPath = path.join(sharedToolsDir, script);

      try {
        // Check if symlink/file already exists
        try {
          await fs.promises.access(targetPath);
          // File exists, skip
          logger.debug({ tenantId, script }, 'Shared tool symlink already exists, skipping');
          continue;
        } catch {
          // File does not exist, create symlink
        }

        // On Windows, use file copy as symlinks require admin privileges
        // On Unix, use actual symlinks
        const isWindows = process.platform === 'win32';
        if (isWindows) {
          await fs.promises.copyFile(sourcePath, targetPath);
          logger.info({ tenantId, script, targetPath }, 'Copied shared tool (Windows)');
        } else {
          await fs.promises.symlink(sourcePath, targetPath);
          logger.info({ tenantId, script, targetPath }, 'Created shared tool symlink');
        }
      } catch (error) {
        logger.warn(
          { tenantId, script, error },
          'Failed to create shared tool symlink/copy'
        );
      }
    }
  }

  /**
   * Initialize a tenant folder for Claude CLI mode.
   * Orchestrates all setup functions. Cached to avoid redundant I/O.
   */
  async initializeTenantForCli(tenantId: string): Promise<void> {
    // Skip if already initialized this session
    if (this.initializedTenants.has(tenantId)) {
      logger.debug({ tenantId }, 'Tenant already initialized, skipping');
      return;
    }

    const tenantFolder = this.getTenantFolder(tenantId);

    // Create tenant folder if it doesn't exist
    if (!fs.existsSync(tenantFolder)) {
      logger.info({ tenantId }, 'Creating tenant folder');
      await fs.promises.mkdir(tenantFolder, { recursive: true });
    }

    logger.info({ tenantId }, 'Initializing tenant folder for CLI mode');

    // Create staging and backup directories for self-modification tools
    try {
      const stagingDir = path.join(tenantFolder, '.staging', 'tools');
      const backupsDir = path.join(tenantFolder, '.backups');
      await fs.promises.mkdir(stagingDir, { recursive: true });
      await fs.promises.mkdir(path.join(backupsDir, 'directives'), { recursive: true });
      await fs.promises.mkdir(path.join(backupsDir, 'tools'), { recursive: true });
      logger.info({ tenantId }, 'Staging and backup directories created');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to create staging/backup directories');
    }

    // Run all setup functions
    try {
      await this.ensureLifeFolder(tenantId);
      logger.info({ tenantId }, 'Life folder setup complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to setup life folder');
    }

    try {
      await this.ensureBoundariesFile(tenantId);
      logger.info({ tenantId }, 'Boundaries file setup complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to setup boundaries file');
    }

    try {
      await this.ensureStateFolder(tenantId);
      logger.info({ tenantId }, 'State folder setup complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to setup state folder');
    }

    try {
      await this.ensureHistoryFolder(tenantId);
      logger.info({ tenantId }, 'History folder setup complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to setup history folder');
    }

    try {
      await this.ensureClaudeMd(tenantId);
      logger.info({ tenantId }, 'CLAUDE.md generation complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to generate CLAUDE.md');
    }

    try {
      await this.generateSettingsJson(tenantId);
      logger.info({ tenantId }, 'Settings.json generation complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to generate settings.json');
    }

    try {
      await this.setupSharedTools(tenantId);
      logger.info({ tenantId }, 'Shared tools setup complete');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to setup shared tools');
    }

    // Mark as initialized
    this.initializedTenants.add(tenantId);
    logger.info({ tenantId }, 'Tenant folder initialization complete');
  }

  /**
   * Sync recent messages to state/recent_messages.json for Claude context.
   * Called on new session start to provide conversation continuity.
   */
  async syncRecentMessages(tenantId: string, limit: number = 25): Promise<void> {
    const tenantFolder = this.getTenantFolder(tenantId);
    const stateDir = path.join(tenantFolder, 'state');
    const recentMessagesPath = path.join(stateDir, 'recent_messages.json');

    try {
      // Ensure state directory exists
      await fs.promises.mkdir(stateDir, { recursive: true });

      // Query recent messages from database
      const prisma = getPrismaClient();
      const messages = await prisma.messages.findMany({
        where: { tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        take: limit,
        select: {
          content: true,
          direction: true,
          created_at: true,
        },
      });

      // Format for Claude consumption (reverse to chronological order)
      const formatted = messages.reverse().map(m => ({
        timestamp: m.created_at.toISOString(),
        direction: m.direction,
        content: m.content,
      }));

      const data = {
        lastSynced: new Date().toISOString(),
        messageCount: formatted.length,
        messages: formatted,
      };

      await fs.promises.writeFile(recentMessagesPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.info({ tenantId, messageCount: formatted.length }, 'Synced recent messages to state folder');
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to sync recent messages');
      // Non-fatal - don't throw, just log the error
    }
  }
}
