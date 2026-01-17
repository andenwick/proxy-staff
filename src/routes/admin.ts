import { FastifyPluginAsync } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import { logger as baseLogger } from '../utils/logger.js';
import { getCampaignScheduler, getToolHealthService } from '../services/index.js';

const logger = baseLogger.child({ module: 'admin-routes' });

interface SetCredentialsBody {
  credentials: Record<string, string>;
}

interface SetCredentialsParams {
  tenantId: string;
}

interface CredentialsResponse {
  success: boolean;
  message: string;
  tenantId: string;
  keysSet?: string[];
}

interface HealthCheckBody {
  tenantId?: string;
}

/**
 * Admin routes for tenant management.
 *
 * These endpoints require the ADMIN_API_KEY to be set and passed
 * in the Authorization header as: Bearer <ADMIN_API_KEY>
 */
export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const adminApiKey = process.env.ADMIN_API_KEY;

  // Auth hook for all admin routes
  fastify.addHook('onRequest', async (request, reply) => {
    if (!adminApiKey) {
      logger.error('ADMIN_API_KEY not configured');
      return reply.status(500).send({ error: 'Admin API not configured' });
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);
    if (token !== adminApiKey) {
      return reply.status(403).send({ error: 'Invalid API key' });
    }
  });

  /**
   * Set credentials for a tenant
   *
   * POST /admin/tenants/:tenantId/credentials
   * Body: { credentials: { KEY: "value", ... } }
   *
   * Writes credentials to the tenant's .env file.
   * Existing keys are overwritten, new keys are added.
   */
  fastify.post<{
    Params: SetCredentialsParams;
    Body: SetCredentialsBody;
    Reply: CredentialsResponse;
  }>('/admin/tenants/:tenantId/credentials', async (request, reply) => {
    const { tenantId } = request.params;
    const { credentials } = request.body;

    if (!credentials || typeof credentials !== 'object') {
      return reply.status(400).send({
        success: false,
        message: 'Missing or invalid credentials object',
        tenantId,
      });
    }

    // Validate tenant ID (prevent path traversal)
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid tenant ID format',
        tenantId,
      });
    }

    const tenantFolder = path.join(process.cwd(), 'tenants', tenantId);
    const envPath = path.join(tenantFolder, '.env');

    // Check if tenant folder exists
    if (!fs.existsSync(tenantFolder)) {
      return reply.status(404).send({
        success: false,
        message: 'Tenant folder not found',
        tenantId,
      });
    }

    try {
      // Read existing .env if it exists
      let existingEnv: Record<string, string> = {};
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
              const key = trimmed.substring(0, eqIndex);
              const value = trimmed.substring(eqIndex + 1);
              existingEnv[key] = value;
            }
          }
        }
      }

      // Merge new credentials (overwrites existing)
      const mergedEnv = { ...existingEnv, ...credentials };

      // Write .env file (quote values that contain spaces or special chars)
      const envContent = Object.entries(mergedEnv)
        .map(([key, value]) => {
          // Quote values containing spaces, quotes, or newlines
          const needsQuotes = /[\s"'\n]/.test(value);
          const escapedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
          return `${key}=${escapedValue}`;
        })
        .join('\n');

      fs.writeFileSync(envPath, envContent + '\n', 'utf-8');

      logger.info({ tenantId, keysSet: Object.keys(credentials) }, 'Tenant credentials updated');

      return reply.send({
        success: true,
        message: 'Credentials saved successfully',
        tenantId,
        keysSet: Object.keys(credentials),
      });
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to save credentials');
      return reply.status(500).send({
        success: false,
        message: 'Failed to save credentials',
        tenantId,
      });
    }
  });

  /**
   * Get credential keys for a tenant (not values, for security)
   *
   * GET /admin/tenants/:tenantId/credentials
   *
   * Returns list of configured credential keys (not values).
   */
  fastify.get<{
    Params: SetCredentialsParams;
  }>('/admin/tenants/:tenantId/credentials', async (request, reply) => {
    const { tenantId } = request.params;

    // Validate tenant ID
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid tenant ID format',
        tenantId,
      });
    }

    const tenantFolder = path.join(process.cwd(), 'tenants', tenantId);
    const envPath = path.join(tenantFolder, '.env');

    if (!fs.existsSync(envPath)) {
      return reply.send({
        success: true,
        tenantId,
        keys: [],
        message: 'No credentials configured',
      });
    }

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const keys: string[] = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            keys.push(trimmed.substring(0, eqIndex));
          }
        }
      }

      return reply.send({
        success: true,
        tenantId,
        keys,
      });
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to read credentials');
      return reply.status(500).send({
        success: false,
        message: 'Failed to read credentials',
        tenantId,
      });
    }
  });

  /**
   * Trigger campaign processing for a tenant
   *
   * POST /admin/tenants/:tenantId/campaigns/trigger
   *
   * Manually triggers the campaign scheduler for a specific tenant.
   */
  fastify.post<{
    Params: { tenantId: string };
  }>('/admin/tenants/:tenantId/campaigns/trigger', async (request, reply) => {
    const { tenantId } = request.params;

    // Validate tenant ID
    if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      return reply.status(400).send({
        success: false,
        message: 'Invalid tenant ID format',
        tenantId,
      });
    }

    const tenantFolder = path.join(process.cwd(), 'tenants', tenantId);
    if (!fs.existsSync(tenantFolder)) {
      return reply.status(404).send({
        success: false,
        message: 'Tenant folder not found',
        tenantId,
      });
    }

    try {
      const scheduler = getCampaignScheduler();
      logger.info({ tenantId }, 'Manually triggering campaign processing');

      // Process campaigns for this tenant
      await scheduler.processTenantCampaigns(tenantId);

      return reply.send({
        success: true,
        message: 'Campaign processing triggered',
        tenantId,
      });
    } catch (error) {
      logger.error({ tenantId, error }, 'Failed to trigger campaign processing');
      return reply.status(500).send({
        success: false,
        message: `Failed to trigger campaign processing: ${error instanceof Error ? error.message : 'Unknown error'}`,
        tenantId,
      });
    }
  });

  /**
   * Run tool health check suite
   *
   * POST /admin/tools/health-check
   * Body (optional): { tenantId?: string }
   *
   * Runs the tool health check suite for all tenants or a specific tenant.
   * Returns: { passed, failed, skipped, results }
   */
  fastify.post<{
    Body: HealthCheckBody;
  }>('/admin/tools/health-check', async (request, reply) => {
    const tenantId = request.body?.tenantId;

    // Validate tenant ID if provided
    if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      return reply.status(400).send({
        error: 'Invalid tenant ID format',
      });
    }

    try {
      const toolHealthService = getToolHealthService();
      logger.info({ tenantId: tenantId || 'all' }, 'Running tool health check');

      const results = await toolHealthService.runFullSuite(tenantId);

      logger.info(
        { passed: results.passed, failed: results.failed, skipped: results.skipped },
        'Tool health check completed'
      );

      return reply.send(results);
    } catch (error) {
      logger.error({ error }, 'Tool health check failed');
      return reply.status(500).send({
        error: `Tool health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

  /**
   * Run credential health check
   *
   * POST /admin/credentials/health-check
   * Body (optional): { tenantId?: string }
   *
   * Validates credentials for services with destructive tools (skip_test: true).
   * Returns: { valid, invalid, skipped, results }
   */
  fastify.post<{
    Body: HealthCheckBody;
  }>('/admin/credentials/health-check', async (request, reply) => {
    const tenantId = request.body?.tenantId;

    // Validate tenant ID if provided
    if (tenantId && !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
      return reply.status(400).send({
        error: 'Invalid tenant ID format',
      });
    }

    try {
      const toolHealthService = getToolHealthService();
      logger.info({ tenantId: tenantId || 'all' }, 'Running credential health check');

      const results = await toolHealthService.runCredentialChecks(tenantId);

      logger.info(
        { valid: results.valid, invalid: results.invalid, skipped: results.skipped },
        'Credential health check completed'
      );

      return reply.send(results);
    } catch (error) {
      logger.error({ error }, 'Credential health check failed');
      return reply.status(500).send({
        error: `Credential health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });
};
