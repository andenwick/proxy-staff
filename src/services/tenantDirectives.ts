import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { validateTenantId } from '../utils/validation.js';

// Cache entry with timestamp for TTL
interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

// 5-minute TTL in milliseconds
const CACHE_TTL_MS = 5 * 60 * 1000;

// Get project root for tenant folder resolution
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TENANTS_DIR = path.join(PROJECT_ROOT, 'tenants');

export class TenantDirectivesService {
  private systemPromptCache: Map<string, CacheEntry<string>> = new Map();
  private directivesListCache: Map<string, CacheEntry<string[]>> = new Map();

  /**
   * Check if cache entry is still valid (within TTL)
   */
  private isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    return Date.now() - entry.timestamp < CACHE_TTL_MS;
  }

  /**
   * Get tenant directives folder path
   * @throws Error if tenant ID is invalid (path traversal prevention)
   */
  private getDirectivesPath(tenantId: string): string {
    validateTenantId(tenantId);
    return path.join(TENANTS_DIR, tenantId, 'directives');
  }

  /**
   * Load system prompt from tenant's directives/README.md
   * Returns null if file or folder doesn't exist
   */
  async loadSystemPrompt(tenantId: string): Promise<string | null> {
    // Check cache first
    const cached = this.systemPromptCache.get(tenantId);
    if (this.isCacheValid(cached)) {
      return cached.value;
    }

    const readmePath = path.join(this.getDirectivesPath(tenantId), 'README.md');

    try {
      const content = await fs.readFile(readmePath, 'utf-8');

      // Cache the result
      this.systemPromptCache.set(tenantId, {
        value: content,
        timestamp: Date.now(),
      });

      return content;
    } catch (error) {
      // File or folder doesn't exist - graceful fallback
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ tenantId, path: readmePath }, 'System prompt not found, returning null');
        return null;
      }
      // Log unexpected errors but still return null for graceful fallback
      logger.error({ tenantId, error }, 'Error loading system prompt');
      return null;
    }
  }

  /**
   * List all directive files in tenant's directives folder
   * Returns array of filenames without .md extension
   * Returns empty array if folder doesn't exist
   */
  async listDirectives(tenantId: string): Promise<string[]> {
    // Check cache first
    const cached = this.directivesListCache.get(tenantId);
    if (this.isCacheValid(cached)) {
      return cached.value;
    }

    const directivesPath = this.getDirectivesPath(tenantId);

    try {
      const files = await fs.readdir(directivesPath);

      // Filter to .md files and strip extension
      const directives = files
        .filter(file => file.endsWith('.md'))
        .map(file => file.slice(0, -3)); // Remove .md extension

      // Cache the result
      this.directivesListCache.set(tenantId, {
        value: directives,
        timestamp: Date.now(),
      });

      return directives;
    } catch (error) {
      // Folder doesn't exist - graceful fallback
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ tenantId, path: directivesPath }, 'Directives folder not found, returning empty array');
        return [];
      }
      // Log unexpected errors but still return empty array
      logger.error({ tenantId, error }, 'Error listing directives');
      return [];
    }
  }

  /**
   * Load a specific directive by name
   * Name should be without .md extension
   * Returns null if file doesn't exist
   */
  async loadDirective(tenantId: string, name: string): Promise<string | null> {
    // Note: Individual directives are not cached - they are loaded on-demand
    // and the list of directives is already cached for Claude's awareness

    const directivePath = path.join(this.getDirectivesPath(tenantId), `${name}.md`);

    try {
      const content = await fs.readFile(directivePath, 'utf-8');
      return content;
    } catch (error) {
      // File doesn't exist - graceful fallback
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ tenantId, name, path: directivePath }, 'Directive not found, returning null');
        return null;
      }
      // Log unexpected errors but still return null
      logger.error({ tenantId, name, error }, 'Error loading directive');
      return null;
    }
  }

  /**
   * Clear all caches (useful for testing or manual cache invalidation)
   */
  clearCache(): void {
    this.systemPromptCache.clear();
    this.directivesListCache.clear();
  }
}
