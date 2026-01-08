import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

/**
 * Prospect stages in order of progression.
 */
export type ProspectStage =
  | 'identified'
  | 'researched'
  | 'contacted'
  | 'replied'
  | 'qualified'
  | 'booked'
  | 'won'
  | 'lost';

/**
 * Frontmatter fields for prospect files.
 */
export interface ProspectFrontmatter {
  name: string;
  company?: string;
  title?: string;
  email: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  source?: string;
  source_query?: string;
  stage: ProspectStage;
  created_at: string;
  updated_at: string;
}

/**
 * Full prospect data including frontmatter and markdown body.
 */
export interface ProspectData {
  slug: string;
  frontmatter: ProspectFrontmatter;
  body: string;
  businessContext?: string;
  researchNotes?: string;
  personalizationHooks?: string;
  interactionHistory?: string;
}

/**
 * Input for creating a new prospect.
 */
export interface CreateProspectInput {
  name: string;
  email: string;
  company?: string;
  title?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  source?: string;
  source_query?: string;
  stage?: ProspectStage;
  businessContext?: string;
  researchNotes?: string;
  personalizationHooks?: string;
}

/**
 * Input for updating a prospect.
 */
export interface UpdateProspectInput {
  name?: string;
  email?: string;
  company?: string;
  title?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  source?: string;
  source_query?: string;
  stage?: ProspectStage;
  businessContext?: string;
  researchNotes?: string;
  personalizationHooks?: string;
  interactionHistoryAppend?: string;
}

/**
 * ProspectService manages prospect files in tenant folders.
 *
 * Prospect files are stored at: tenants/{tenantId}/relationships/prospects/{slug}.md
 * - Uses JSON frontmatter format
 * - Markdown body contains: Business Context, Research Notes, Personalization Hooks, Interaction History
 */
export class ProspectService {
  private projectRoot: string;
  private emailCache: Map<string, Map<string, string>> = new Map(); // tenantId -> (email -> slug)

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot ?? process.cwd();
  }

  /**
   * Get the path to a tenant's prospects folder.
   */
  private getProspectsFolder(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(this.projectRoot, 'tenants', tenantId, 'relationships', 'prospects');
  }

  /**
   * Get the path to a specific prospect file.
   */
  private getProspectPath(tenantId: string, slug: string): string {
    return path.join(this.getProspectsFolder(tenantId), `${slug}.md`);
  }

  /**
   * Generate a slug from a name (kebab-case).
   */
  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, ''); // Trim leading/trailing hyphens
  }

  /**
   * Ensure slug is unique by appending a number if necessary.
   */
  private async ensureUniqueSlug(tenantId: string, baseSlug: string): Promise<string> {
    const prospectsFolder = this.getProspectsFolder(tenantId);

    // Ensure directory exists
    if (!fs.existsSync(prospectsFolder)) {
      return baseSlug;
    }

    let slug = baseSlug;
    let counter = 1;

    while (fs.existsSync(this.getProspectPath(tenantId, slug))) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
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
   * Parse markdown body into sections by splitting on headers.
   */
  private parseBodySections(markdown: string): {
    businessContext: string;
    researchNotes: string;
    personalizationHooks: string;
    interactionHistory: string;
  } {
    const sections = {
      businessContext: '',
      researchNotes: '',
      personalizationHooks: '',
      interactionHistory: '',
    };

    // Split the markdown by ## headers
    const parts = markdown.split(/^## /m);

    for (const part of parts) {
      if (!part.trim()) continue;

      const lines = part.split('\n');
      const header = lines[0].trim();
      const content = lines.slice(1).join('\n').trim();

      switch (header) {
        case 'Business Context':
          sections.businessContext = content;
          break;
        case 'Research Notes':
          sections.researchNotes = content;
          break;
        case 'Personalization Hooks':
          sections.personalizationHooks = content;
          break;
        case 'Interaction History':
          sections.interactionHistory = content;
          break;
      }
    }

    return sections;
  }

  /**
   * Build markdown body from sections.
   */
  private buildMarkdownBody(
    businessContext?: string,
    researchNotes?: string,
    personalizationHooks?: string,
    interactionHistory?: string
  ): string {
    const sections: string[] = [];

    sections.push('## Business Context');
    sections.push(businessContext || '');
    sections.push('');

    sections.push('## Research Notes');
    sections.push(researchNotes || '');
    sections.push('');

    sections.push('## Personalization Hooks');
    sections.push(personalizationHooks || '');
    sections.push('');

    sections.push('## Interaction History');
    sections.push(interactionHistory || '');

    return sections.join('\n');
  }

  /**
   * Initialize email cache for a tenant.
   */
  async initializeCache(tenantId: string): Promise<void> {
    const prospects = await this.listProspects(tenantId);
    const cache = new Map<string, string>();

    for (const prospect of prospects) {
      if (prospect.frontmatter.email) {
        cache.set(prospect.frontmatter.email.toLowerCase(), prospect.slug);
      }
    }

    this.emailCache.set(tenantId, cache);
    logger.debug({ tenantId, cacheSize: cache.size }, 'Prospect email cache initialized');
  }

  /**
   * Update email cache when prospect is created or updated.
   */
  private updateCache(tenantId: string, email: string, slug: string): void {
    let cache = this.emailCache.get(tenantId);
    if (!cache) {
      cache = new Map<string, string>();
      this.emailCache.set(tenantId, cache);
    }
    cache.set(email.toLowerCase(), slug);
  }

  /**
   * Find prospect by email (O(1) lookup).
   */
  async findProspectByEmail(tenantId: string, email: string): Promise<ProspectData | null> {
    // Initialize cache if not exists
    if (!this.emailCache.has(tenantId)) {
      await this.initializeCache(tenantId);
    }

    const cache = this.emailCache.get(tenantId);
    if (!cache) {
      return null;
    }

    const slug = cache.get(email.toLowerCase());
    if (!slug) {
      return null;
    }

    return this.readProspect(tenantId, slug);
  }

  /**
   * Create a new prospect.
   */
  async createProspect(tenantId: string, input: CreateProspectInput): Promise<ProspectData> {
    // Validate required fields
    if (!input.name || input.name.trim().length === 0) {
      throw new Error('Prospect name is required');
    }
    if (!input.email || input.email.trim().length === 0) {
      throw new Error('Prospect email is required');
    }

    const prospectsFolder = this.getProspectsFolder(tenantId);

    // Ensure directory exists
    if (!fs.existsSync(prospectsFolder)) {
      await fs.promises.mkdir(prospectsFolder, { recursive: true });
    }

    // Generate unique slug
    const baseSlug = this.generateSlug(input.name);
    const slug = await this.ensureUniqueSlug(tenantId, baseSlug);

    const now = new Date().toISOString();

    const frontmatter: ProspectFrontmatter = {
      name: input.name.trim(),
      email: input.email.trim(),
      company: input.company,
      title: input.title,
      phone: input.phone,
      website: input.website,
      linkedin: input.linkedin,
      source: input.source,
      source_query: input.source_query,
      stage: input.stage ?? 'identified',
      created_at: now,
      updated_at: now,
    };

    const markdown = this.buildMarkdownBody(
      input.businessContext,
      input.researchNotes,
      input.personalizationHooks,
      ''
    );

    const content = this.serializeFrontmatter(frontmatter, markdown);
    const filePath = this.getProspectPath(tenantId, slug);

    await fs.promises.writeFile(filePath, content, 'utf-8');

    // Update cache
    this.updateCache(tenantId, input.email, slug);

    logger.info({ tenantId, slug, email: input.email }, 'Prospect created');

    return {
      slug,
      frontmatter,
      body: markdown,
      businessContext: input.businessContext,
      researchNotes: input.researchNotes,
      personalizationHooks: input.personalizationHooks,
      interactionHistory: '',
    };
  }

  /**
   * Read a prospect by slug.
   */
  async readProspect(tenantId: string, slug: string): Promise<ProspectData | null> {
    const filePath = this.getProspectPath(tenantId, slug);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const { data: frontmatter, markdown } = this.parseFrontmatter<ProspectFrontmatter>(content);
      const sections = this.parseBodySections(markdown);

      return {
        slug,
        frontmatter,
        body: markdown,
        ...sections,
      };
    } catch (error) {
      logger.error({ tenantId, slug, error }, 'Failed to read prospect');
      return null;
    }
  }

  /**
   * Update a prospect (preserves interaction history).
   */
  async updateProspect(tenantId: string, slug: string, updates: UpdateProspectInput): Promise<ProspectData> {
    const existing = await this.readProspect(tenantId, slug);
    if (!existing) {
      throw new Error(`Prospect "${slug}" not found`);
    }

    const now = new Date().toISOString();

    // Update frontmatter fields
    const frontmatter: ProspectFrontmatter = {
      ...existing.frontmatter,
      updated_at: now,
    };

    if (updates.name !== undefined) frontmatter.name = updates.name;
    if (updates.email !== undefined) frontmatter.email = updates.email;
    if (updates.company !== undefined) frontmatter.company = updates.company;
    if (updates.title !== undefined) frontmatter.title = updates.title;
    if (updates.phone !== undefined) frontmatter.phone = updates.phone;
    if (updates.website !== undefined) frontmatter.website = updates.website;
    if (updates.linkedin !== undefined) frontmatter.linkedin = updates.linkedin;
    if (updates.source !== undefined) frontmatter.source = updates.source;
    if (updates.source_query !== undefined) frontmatter.source_query = updates.source_query;
    if (updates.stage !== undefined) frontmatter.stage = updates.stage;

    // Update body sections (preserve interaction history, allow append)
    let businessContext = existing.businessContext ?? '';
    let researchNotes = existing.researchNotes ?? '';
    let personalizationHooks = existing.personalizationHooks ?? '';
    let interactionHistory = existing.interactionHistory ?? '';

    if (updates.businessContext !== undefined) businessContext = updates.businessContext;
    if (updates.researchNotes !== undefined) researchNotes = updates.researchNotes;
    if (updates.personalizationHooks !== undefined) personalizationHooks = updates.personalizationHooks;
    if (updates.interactionHistoryAppend) {
      interactionHistory = interactionHistory
        ? `${interactionHistory}\n\n${updates.interactionHistoryAppend}`
        : updates.interactionHistoryAppend;
    }

    const markdown = this.buildMarkdownBody(
      businessContext,
      researchNotes,
      personalizationHooks,
      interactionHistory
    );

    const content = this.serializeFrontmatter(frontmatter, markdown);
    const filePath = this.getProspectPath(tenantId, slug);

    await fs.promises.writeFile(filePath, content, 'utf-8');

    // Update cache if email changed
    if (updates.email && updates.email !== existing.frontmatter.email) {
      this.updateCache(tenantId, updates.email, slug);
    }

    logger.debug({ tenantId, slug }, 'Prospect updated');

    return {
      slug,
      frontmatter,
      body: markdown,
      businessContext,
      researchNotes,
      personalizationHooks,
      interactionHistory,
    };
  }

  /**
   * List all prospects for a tenant.
   */
  async listProspects(tenantId: string): Promise<ProspectData[]> {
    const prospectsFolder = this.getProspectsFolder(tenantId);

    if (!fs.existsSync(prospectsFolder)) {
      return [];
    }

    const prospects: ProspectData[] = [];
    const entries = await fs.promises.readdir(prospectsFolder, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const slug = entry.name.replace('.md', '');
        const prospect = await this.readProspect(tenantId, slug);
        if (prospect) {
          prospects.push(prospect);
        }
      }
    }

    return prospects;
  }

  /**
   * Delete a prospect (for testing/cleanup).
   */
  async deleteProspect(tenantId: string, slug: string): Promise<boolean> {
    const filePath = this.getProspectPath(tenantId, slug);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    // Get email before deleting for cache update
    const prospect = await this.readProspect(tenantId, slug);
    if (prospect) {
      const cache = this.emailCache.get(tenantId);
      if (cache && prospect.frontmatter.email) {
        cache.delete(prospect.frontmatter.email.toLowerCase());
      }
    }

    await fs.promises.unlink(filePath);
    logger.debug({ tenantId, slug }, 'Prospect deleted');

    return true;
  }
}
