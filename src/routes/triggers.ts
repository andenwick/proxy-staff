import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { TriggerType, AutonomyLevel, TriggerStatus, ConfirmationStatus } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { encryptCredential } from '../utils/encryption.js';
import type {
  CreateTriggerRequest,
  UpdateTriggerRequest,
  TriggerResponse,
  PendingConfirmation,
  ConfirmationRequest,
} from '../types/trigger.js';

// Type augmentations are in src/types/fastify.d.ts

/**
 * # Trigger API Reference
 *
 * Trigger management routes for automated task execution.
 * All routes require tenant authentication via Bearer token.
 *
 * ## Endpoints
 *
 * ### CRUD Operations
 * - `POST   /api/triggers`           - Create a new trigger
 * - `GET    /api/triggers`           - List all triggers for user
 * - `GET    /api/triggers/:id`       - Get a specific trigger
 * - `PATCH  /api/triggers/:id`       - Update a trigger
 * - `DELETE /api/triggers/:id`       - Delete a trigger
 *
 * ### Status Management
 * - `POST   /api/triggers/:id/enable`  - Enable a disabled trigger
 * - `POST   /api/triggers/:id/disable` - Pause a trigger
 * - `POST   /api/triggers/:id/test`    - Manually fire a trigger for testing
 *
 * ### Confirmation Flow (for CONFIRM autonomy triggers)
 * - `GET    /api/triggers/confirmations/pending` - List pending confirmations
 * - `POST   /api/triggers/confirm`               - Approve or reject execution
 *
 * ## Trigger Types
 * - `TIME`      - Scheduled (cron-based) triggers
 * - `EVENT`     - External event triggers (email, etc.)
 * - `CONDITION` - Polled condition checks
 * - `WEBHOOK`   - Incoming webhook triggers (auto-generates unique URL)
 *
 * ## Autonomy Levels
 * - `NOTIFY`  - Only notify user when triggered (default)
 * - `CONFIRM` - Ask for confirmation before executing
 * - `AUTO`    - Execute automatically without user input
 *
 * ## Webhook Triggers
 * When creating a WEBHOOK trigger, a unique URL is generated:
 * `{PUBLIC_URL}/webhooks/trigger/{webhook_path}`
 *
 * Signature verification is supported via X-Hub-Signature-256 header.
 */
export const triggerRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.prisma;

  // ==========================================
  // CRUD Operations
  // ==========================================

  /**
   * Create a new trigger
   * POST /api/triggers
   */
  fastify.post<{ Body: CreateTriggerRequest }>(
    '/api/triggers',
    async (request: FastifyRequest<{ Body: CreateTriggerRequest }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const { name, description, trigger_type, config, task_prompt, autonomy, cooldown_seconds } = request.body;

      // Validate required fields
      if (!name || !trigger_type || !config || !task_prompt) {
        throw new AppError('Missing required fields', 'VALIDATION_ERROR', 400);
      }

      // For webhook triggers, generate unique path and secret
      let webhookPath: string | null = null;
      let webhookSecret: string | null = null;

      if (trigger_type === TriggerType.WEBHOOK) {
        webhookPath = `${tenantId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const secret = crypto.randomUUID();
        webhookSecret = encryptCredential(secret);
      }

      const trigger = await prisma.triggers.create({
        data: {
          tenant_id: tenantId,
          user_phone: userPhone,
          name,
          description: description || null,
          trigger_type: trigger_type as TriggerType,
          config: config as object,
          task_prompt,
          autonomy: (autonomy as AutonomyLevel) || AutonomyLevel.NOTIFY,
          cooldown_seconds: cooldown_seconds || 0,
          webhook_path: webhookPath,
          webhook_secret: webhookSecret,
        },
      });

      const response: TriggerResponse = {
        id: trigger.id,
        name: trigger.name,
        description: trigger.description,
        trigger_type: trigger.trigger_type,
        config: trigger.config as CreateTriggerRequest['config'],
        task_prompt: trigger.task_prompt,
        autonomy: trigger.autonomy,
        status: trigger.status,
        cooldown_seconds: trigger.cooldown_seconds,
        webhook_url: webhookPath ? `${process.env.PUBLIC_URL || 'http://localhost:3000'}/webhooks/trigger/${webhookPath}` : undefined,
        last_triggered_at: trigger.last_triggered_at?.toISOString() || null,
        created_at: trigger.created_at.toISOString(),
      };

      logger.info({ triggerId: trigger.id, name, trigger_type }, 'Created trigger');
      return reply.status(201).send(response);
    }
  );

  /**
   * List all triggers for the authenticated tenant/user
   * GET /api/triggers
   */
  fastify.get('/api/triggers', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId;
    const userPhone = request.userPhone;

    if (!tenantId || !userPhone) {
      throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
    }

    const triggers = await prisma.triggers.findMany({
      where: {
        tenant_id: tenantId,
        user_phone: userPhone,
      },
      orderBy: { created_at: 'desc' },
    });

    const response: TriggerResponse[] = triggers.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      trigger_type: t.trigger_type,
      config: t.config as CreateTriggerRequest['config'],
      task_prompt: t.task_prompt,
      autonomy: t.autonomy,
      status: t.status,
      cooldown_seconds: t.cooldown_seconds,
      webhook_url: t.webhook_path ? `${process.env.PUBLIC_URL || 'http://localhost:3000'}/webhooks/trigger/${t.webhook_path}` : undefined,
      last_triggered_at: t.last_triggered_at?.toISOString() || null,
      created_at: t.created_at.toISOString(),
    }));

    return reply.send(response);
  });

  /**
   * Get a specific trigger by ID
   * GET /api/triggers/:id
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/triggers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const trigger = await prisma.triggers.findFirst({
        where: {
          id,
          tenant_id: tenantId,
          user_phone: userPhone,
        },
      });

      if (!trigger) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      const response: TriggerResponse = {
        id: trigger.id,
        name: trigger.name,
        description: trigger.description,
        trigger_type: trigger.trigger_type,
        config: trigger.config as CreateTriggerRequest['config'],
        task_prompt: trigger.task_prompt,
        autonomy: trigger.autonomy,
        status: trigger.status,
        cooldown_seconds: trigger.cooldown_seconds,
        webhook_url: trigger.webhook_path ? `${process.env.PUBLIC_URL || 'http://localhost:3000'}/webhooks/trigger/${trigger.webhook_path}` : undefined,
        last_triggered_at: trigger.last_triggered_at?.toISOString() || null,
        created_at: trigger.created_at.toISOString(),
      };

      return reply.send(response);
    }
  );

  /**
   * Update a trigger
   * PATCH /api/triggers/:id
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateTriggerRequest }>(
    '/api/triggers/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateTriggerRequest }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;
      const updates = request.body;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      // Verify ownership
      const existing = await prisma.triggers.findFirst({
        where: { id, tenant_id: tenantId, user_phone: userPhone },
      });

      if (!existing) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      const trigger = await prisma.triggers.update({
        where: { id },
        data: {
          name: updates.name,
          description: updates.description,
          config: updates.config ? ({ ...(existing.config as object), ...updates.config } as object) : undefined,
          task_prompt: updates.task_prompt,
          autonomy: updates.autonomy as AutonomyLevel | undefined,
          cooldown_seconds: updates.cooldown_seconds,
        },
      });

      logger.info({ triggerId: id }, 'Updated trigger');
      return reply.send({ success: true, id: trigger.id });
    }
  );

  /**
   * Delete a trigger
   * DELETE /api/triggers/:id
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/triggers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      // Verify ownership
      const existing = await prisma.triggers.findFirst({
        where: { id, tenant_id: tenantId, user_phone: userPhone },
      });

      if (!existing) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      await prisma.triggers.delete({ where: { id } });

      logger.info({ triggerId: id }, 'Deleted trigger');
      return reply.send({ success: true });
    }
  );

  // ==========================================
  // Status Management
  // ==========================================

  /**
   * Enable a trigger
   * POST /api/triggers/:id/enable
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/triggers/:id/enable',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const existing = await prisma.triggers.findFirst({
        where: { id, tenant_id: tenantId, user_phone: userPhone },
      });

      if (!existing) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      await prisma.triggers.update({
        where: { id },
        data: { status: TriggerStatus.ACTIVE, error_count: 0 },
      });

      logger.info({ triggerId: id }, 'Enabled trigger');
      return reply.send({ success: true });
    }
  );

  /**
   * Disable a trigger
   * POST /api/triggers/:id/disable
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/triggers/:id/disable',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const existing = await prisma.triggers.findFirst({
        where: { id, tenant_id: tenantId, user_phone: userPhone },
      });

      if (!existing) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      await prisma.triggers.update({
        where: { id },
        data: { status: TriggerStatus.PAUSED },
      });

      logger.info({ triggerId: id }, 'Disabled trigger');
      return reply.send({ success: true });
    }
  );

  /**
   * Test a trigger manually
   * POST /api/triggers/:id/test
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/triggers/:id/test',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { id } = request.params;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      const trigger = await prisma.triggers.findFirst({
        where: { id, tenant_id: tenantId, user_phone: userPhone },
      });

      if (!trigger) {
        throw new AppError('Trigger not found', 'NOT_FOUND', 404);
      }

      // Get trigger evaluator from fastify (injected during server setup)
      const triggerEvaluator = fastify.triggerEvaluator;
      if (!triggerEvaluator) {
        throw new AppError('Trigger service not available', 'SERVICE_UNAVAILABLE', 503);
      }

      // Create test event
      await triggerEvaluator.handleTriggerEvent({
        triggerId: trigger.id,
        tenantId: trigger.tenant_id,
        userPhone: trigger.user_phone,
        triggerType: trigger.trigger_type,
        autonomy: trigger.autonomy,
        taskPrompt: trigger.task_prompt,
        payload: {
          source: 'test:manual',
          data: { test: true, timestamp: new Date().toISOString() },
        },
        timestamp: new Date(),
      });

      logger.info({ triggerId: id }, 'Tested trigger');
      return reply.send({ success: true, message: 'Test trigger initiated' });
    }
  );

  // ==========================================
  // Confirmation Flow
  // ==========================================

  /**
   * List pending confirmations for authenticated user
   * GET /api/triggers/confirmations/pending
   */
  fastify.get('/api/triggers/confirmations/pending', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId;
    const userPhone = request.userPhone;

    if (!tenantId || !userPhone) {
      throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
    }

    const executions = await prisma.trigger_executions.findMany({
      where: {
        tenant_id: tenantId,
        confirmation_status: ConfirmationStatus.PENDING,
        confirmation_deadline: { gt: new Date() },
        triggers: {
          user_phone: userPhone,
        },
      },
      include: {
        triggers: {
          select: { name: true, task_prompt: true },
        },
      },
      orderBy: { started_at: 'desc' },
    });

    const response: PendingConfirmation[] = executions.map((e) => ({
      execution_id: e.id,
      trigger_name: e.triggers.name,
      task_prompt: e.triggers.task_prompt,
      triggered_by: e.triggered_by || 'unknown',
      deadline: e.confirmation_deadline!.toISOString(),
      created_at: e.started_at.toISOString(),
    }));

    return reply.send(response);
  });

  /**
   * Approve or reject a confirmation
   * POST /api/triggers/confirm
   */
  fastify.post<{ Body: ConfirmationRequest }>(
    '/api/triggers/confirm',
    async (request: FastifyRequest<{ Body: ConfirmationRequest }>, reply: FastifyReply) => {
      const tenantId = request.tenantId;
      const userPhone = request.userPhone;
      const { execution_id, approved } = request.body;

      if (!tenantId || !userPhone) {
        throw new AppError('Tenant context required', 'AUTH_REQUIRED', 401);
      }

      if (!execution_id) {
        throw new AppError('Missing execution_id', 'VALIDATION_ERROR', 400);
      }

      // Get trigger evaluator
      const triggerEvaluator = fastify.triggerEvaluator;
      if (!triggerEvaluator) {
        throw new AppError('Trigger service not available', 'SERVICE_UNAVAILABLE', 503);
      }

      const result = await triggerEvaluator.handleConfirmationResponse(tenantId, userPhone, approved);

      if (!result.handled) {
        throw new AppError('No pending confirmation found', 'NOT_FOUND', 404);
      }

      logger.info({ executionId: execution_id, approved }, 'Confirmation processed');
      return reply.send({ success: true, message: result.message });
    }
  );
};
