import { FastifyPluginAsync } from 'fastify';
import { TriggerType, AutonomyLevel, TriggerStatus, scheduled_tasks } from '@prisma/client';
import { getPrismaClient } from '../services/prisma.js';
import { getTenantFolderService } from '../services/index.js';
import { createRequestLogger } from '../utils/logger.js';
import { parseSchedule, calculateNextRun } from '../services/scheduleParser.js';
import { AppError } from '../middleware/errorHandler.js';
import { encryptCredential, decryptCredential } from '../utils/encryption.js';
import { browserSessionManager } from '../services/browserSessionManager.js';
import * as path from 'path';
import * as fs from 'fs';

interface ScheduleTaskBody {
  task: string;
  schedule: string;
  taskType?: 'execute' | 'reminder';
  task_type?: 'execute' | 'reminder';
  tenantId?: string;
  tenant_id?: string;
  senderPhone?: string;
  sender_phone?: string;
}

interface CancelScheduleBody {
  task_id?: string;
  taskId?: string;  // Support both snake_case and camelCase
}

interface RefreshConfigBody {
  tenantId: string;
}

export const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/tools/schedule-task - Schedule a recurring task
   */
  fastify.post<{ Body: ScheduleTaskBody }>(
    '/api/tools/schedule-task',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const body = request.body;

      // Support both camelCase and snake_case field names
      const task = body.task;
      const schedule = body.schedule;
      const task_type = body.taskType || body.task_type || 'reminder';
      const tenant_id = body.tenantId || body.tenant_id;
      const sender_phone = body.senderPhone || body.sender_phone;

      logger.info({ task, schedule, task_type, tenant_id }, 'Scheduling task');

      try {
        // Parse the natural language schedule
        const parsed = parseSchedule(schedule, 'America/Denver');
        if (!parsed) {
          throw new AppError('Invalid schedule format', 'INVALID_SCHEDULE', 400);
        }

        // Calculate next run time
        let nextRun: Date;
        if (parsed.isRecurring && parsed.cronExpr) {
          nextRun = calculateNextRun(parsed.cronExpr, parsed.timezone);
        } else if (parsed.runAt) {
          nextRun = parsed.runAt;
        } else {
          throw new AppError('Could not determine next run time', 'INVALID_SCHEDULE', 400);
        }

        // Create the scheduled task
        const prisma = getPrismaClient();
        const scheduledTask = await prisma.scheduled_tasks.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: tenant_id!,
            user_phone: sender_phone!,
            task_prompt: task,
            task_type: task_type,
            cron_expr: parsed.isRecurring ? parsed.cronExpr : null,
            run_at: parsed.isRecurring ? null : parsed.runAt,
            timezone: parsed.timezone,
            is_one_time: !parsed.isRecurring,
            next_run_at: nextRun,
            enabled: true,
            updated_at: new Date(),
          },
        });

        logger.info({ taskId: scheduledTask.id }, 'Task scheduled successfully');

        return reply.status(201).send({
          success: true,
          message: 'Task scheduled successfully',
          task_id: scheduledTask.id,
          next_run: scheduledTask.next_run_at,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to schedule task');
        throw new AppError('Failed to schedule task', 'SCHEDULE_ERROR', 500);
      }
    }
  );

  /**
   * POST /api/tools/cancel-schedule - Cancel a scheduled task
   */
  fastify.post<{ Body: CancelScheduleBody }>(
    '/api/tools/cancel-schedule',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      // Support both snake_case and camelCase field names
      const task_id = request.body.task_id || request.body.taskId;

      if (!task_id) {
        throw new AppError('task_id is required', 'MISSING_TASK_ID', 400);
      }

      logger.info({ taskId: task_id }, 'Cancelling scheduled task');

      try {
        const prisma = getPrismaClient();

        // Check if task exists
        const task = await prisma.scheduled_tasks.findUnique({
          where: { id: task_id },
        });

        if (!task) {
          throw new AppError('Task not found', 'TASK_NOT_FOUND', 404);
        }

        // Delete the task
        await prisma.scheduled_tasks.delete({
          where: { id: task_id },
        });

        logger.info({ taskId: task_id }, 'Task cancelled successfully');

        return reply.send({
          success: true,
          message: 'Task cancelled successfully',
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        logger.error({ error }, 'Failed to cancel task');
        throw new AppError('Failed to cancel task', 'CANCEL_ERROR', 500);
      }
    }
  );

  /**
   * GET /api/tools/list-schedules - List all scheduled tasks for a tenant
   */
  fastify.get<{ Querystring: { tenant_id: string } }>(
    '/api/tools/list-schedules',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id } = request.query;

      logger.info({ tenantId: tenant_id }, 'Listing scheduled tasks');

      try {
        const prisma = getPrismaClient();
        const tasks = await prisma.scheduled_tasks.findMany({
          where: {
            tenant_id: tenant_id,
            enabled: true,
          },
          orderBy: {
            next_run_at: 'asc',
          },
        });

        return reply.send({
          success: true,
          tasks: tasks.map((t: scheduled_tasks) => ({
            id: t.id,
            task: t.task_prompt,
            schedule: t.cron_expr,
            task_type: t.task_type,
            next_run: t.next_run_at,
            created_at: t.created_at,
          })),
        });
      } catch (error) {
        logger.error({ error }, 'Failed to list tasks');
        throw new AppError('Failed to list tasks', 'LIST_ERROR', 500);
      }
    }
  );

  /**
   * GET /api/tools/search-history - Search conversation history
   */
  fastify.get<{
    Querystring: {
      tenant_id: string;
      q?: string;
      direction?: 'INBOUND' | 'OUTBOUND';
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/tools/search-history', async (request, reply) => {
    const logger = createRequestLogger(request.requestId);
    const { tenant_id, q, direction, from, to, limit, offset } = request.query;

    if (!tenant_id) {
      throw new AppError('tenant_id is required', 'MISSING_TENANT_ID', 400);
    }

    const limitNum = Math.min(parseInt(limit || '20', 10), 100);
    const offsetNum = parseInt(offset || '0', 10);

    logger.info({ tenantId: tenant_id, query: q, direction, limit: limitNum }, 'Searching history');

    try {
      const prisma = getPrismaClient();

      // Build where clause
      const where: {
        tenant_id: string;
        direction?: 'INBOUND' | 'OUTBOUND';
        content?: { contains: string; mode: 'insensitive' };
        created_at?: { gte?: Date; lte?: Date };
      } = {
        tenant_id,
      };

      if (direction) {
        where.direction = direction;
      }

      if (q) {
        where.content = { contains: q, mode: 'insensitive' };
      }

      if (from || to) {
        where.created_at = {};
        if (from) where.created_at.gte = new Date(from);
        if (to) where.created_at.lte = new Date(to);
      }

      // Get total count
      const total = await prisma.messages.count({ where });

      // Get messages
      const messages = await prisma.messages.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limitNum,
        skip: offsetNum,
        select: {
          id: true,
          content: true,
          direction: true,
          created_at: true,
          sender_phone: true,
        },
      });

      return reply.send({
        success: true,
        messages: messages.map(m => ({
          id: m.id,
          content: m.content,
          direction: m.direction,
          created_at: m.created_at,
          sender_phone: m.sender_phone,
        })),
        total,
        limit: limitNum,
        offset: offsetNum,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to search history');
      throw new AppError('Failed to search history', 'SEARCH_ERROR', 500);
    }
  });

  /**
   * POST /api/tools/refresh-config - Invalidate tenant config cache
   * Forces CLAUDE.md regeneration on next message
   */
  fastify.post<{ Body: RefreshConfigBody }>(
    '/api/tools/refresh-config',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenantId } = request.body;

      if (!tenantId) {
        return reply.status(400).send({ error: 'tenantId is required' });
      }

      logger.info({ tenantId }, 'Refreshing tenant config cache');

      try {
        const tenantFolderService = getTenantFolderService();
        tenantFolderService.refreshTenantConfig(tenantId);

        return reply.send({
          success: true,
          message: 'Tenant config cache cleared',
        });
      } catch (error) {
        logger.error({ error }, 'Failed to refresh config');
        throw new AppError('Failed to refresh config', 'REFRESH_ERROR', 500);
      }
    }
  );

  // ==========================================
  // Trigger Tool Endpoints
  // ==========================================

  interface CreateTriggerBody {
    tenant_id: string;
    sender_phone: string;
    name: string;
    description?: string;
    trigger_type: 'TIME' | 'EVENT' | 'CONDITION' | 'WEBHOOK';
    config: Record<string, unknown>;
    task_prompt: string;
    autonomy?: 'NOTIFY' | 'CONFIRM' | 'AUTO';
    cooldown_seconds?: number;
  }

  /**
   * POST /api/tools/create-trigger - Create a workflow trigger
   */
  fastify.post<{ Body: CreateTriggerBody }>(
    '/api/tools/create-trigger',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const body = request.body;

      logger.info({ name: body.name, trigger_type: body.trigger_type }, 'Creating trigger');

      try {
        const prisma = getPrismaClient();

        // For webhook triggers, generate unique path and secret
        let webhookPath: string | null = null;
        let webhookSecret: string | null = null;

        if (body.trigger_type === 'WEBHOOK') {
          webhookPath = `${body.tenant_id}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          const secret = crypto.randomUUID();
          webhookSecret = encryptCredential(secret);
        }

        const trigger = await prisma.triggers.create({
          data: {
            tenant_id: body.tenant_id,
            user_phone: body.sender_phone,
            name: body.name,
            description: body.description || null,
            trigger_type: body.trigger_type as TriggerType,
            config: body.config as object,
            task_prompt: body.task_prompt,
            autonomy: (body.autonomy as AutonomyLevel) || AutonomyLevel.NOTIFY,
            cooldown_seconds: body.cooldown_seconds || 0,
            webhook_path: webhookPath,
            webhook_secret: webhookSecret,
          },
        });

        const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

        logger.info({ triggerId: trigger.id }, 'Trigger created successfully');

        return reply.status(201).send({
          success: true,
          message: 'Trigger created successfully',
          trigger_id: trigger.id,
          webhook_url: webhookPath ? `${publicUrl}/webhooks/trigger/${webhookPath}` : null,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to create trigger');
        throw new AppError('Failed to create trigger', 'CREATE_ERROR', 500);
      }
    }
  );

  /**
   * GET /api/tools/list-triggers - List all triggers for a tenant
   */
  fastify.get<{ Querystring: { tenant_id: string; sender_phone?: string } }>(
    '/api/tools/list-triggers',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, sender_phone } = request.query;

      logger.info({ tenantId: tenant_id }, 'Listing triggers');

      try {
        const prisma = getPrismaClient();
        const triggers = await prisma.triggers.findMany({
          where: {
            tenant_id: tenant_id,
            user_phone: sender_phone || undefined,
          },
          orderBy: { created_at: 'desc' },
        });

        const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

        return reply.send({
          success: true,
          triggers: triggers.map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            trigger_type: t.trigger_type,
            autonomy: t.autonomy,
            status: t.status,
            task_prompt: t.task_prompt,
            webhook_url: t.webhook_path ? `${publicUrl}/webhooks/trigger/${t.webhook_path}` : null,
            last_triggered_at: t.last_triggered_at,
            created_at: t.created_at,
          })),
        });
      } catch (error) {
        logger.error({ error }, 'Failed to list triggers');
        throw new AppError('Failed to list triggers', 'LIST_ERROR', 500);
      }
    }
  );

  interface ManageTriggerBody {
    trigger_id: string;
    action: 'enable' | 'disable' | 'delete';
  }

  /**
   * POST /api/tools/manage-trigger - Enable, disable, or delete a trigger
   */
  fastify.post<{ Body: ManageTriggerBody }>(
    '/api/tools/manage-trigger',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { trigger_id, action } = request.body;

      logger.info({ triggerId: trigger_id, action }, 'Managing trigger');

      try {
        const prisma = getPrismaClient();

        // Check if trigger exists
        const trigger = await prisma.triggers.findUnique({
          where: { id: trigger_id },
        });

        if (!trigger) {
          throw new AppError('Trigger not found', 'TRIGGER_NOT_FOUND', 404);
        }

        if (action === 'delete') {
          await prisma.triggers.delete({
            where: { id: trigger_id },
          });
          return reply.send({
            success: true,
            message: 'Trigger deleted successfully',
          });
        }

        const newStatus = action === 'enable' ? TriggerStatus.ACTIVE : TriggerStatus.PAUSED;
        await prisma.triggers.update({
          where: { id: trigger_id },
          data: {
            status: newStatus,
            error_count: action === 'enable' ? 0 : trigger.error_count,
          },
        });

        logger.info({ triggerId: trigger_id, action }, 'Trigger managed successfully');

        return reply.send({
          success: true,
          message: `Trigger ${action}d successfully`,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        logger.error({ error }, 'Failed to manage trigger');
        throw new AppError('Failed to manage trigger', 'MANAGE_ERROR', 500);
      }
    }
  );

  // ==========================================
  // Browser Tool Endpoints
  // ==========================================

  /**
   * Helper to get credential for a tenant
   */
  async function getCredential(tenantId: string, serviceName: string): Promise<string | null> {
    const prisma = getPrismaClient();
    const cred = await prisma.tenant_credentials.findUnique({
      where: {
        tenant_id_service_name: {
          tenant_id: tenantId,
          service_name: serviceName,
        },
      },
    });
    if (!cred) return null;
    return decryptCredential(cred.encrypted_value);
  }

  interface BrowserOpenBody {
    tenant_id: string;
    url: string;
    session_id?: string;
    persistent?: boolean;
  }

  /**
   * POST /api/tools/browser/open - Open browser and navigate to URL
   */
  fastify.post<{ Body: BrowserOpenBody }>(
    '/api/tools/browser/open',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, url, session_id, persistent } = request.body;

      logger.info({ tenantId: tenant_id, url }, 'Opening browser');

      try {
        const session = await browserSessionManager.getOrCreateSession(
          tenant_id,
          session_id,
          { persistent: persistent ?? false }
        );

        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await session.page.title();

        return reply.send({
          success: true,
          session_id: session.id,
          title,
          url: session.page.url(),
        });
      } catch (error) {
        const err = error as Error;
        logger.error({ error: err.message }, 'Failed to open browser');
        throw new AppError(`Browser open failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserLoginBody {
    tenant_id: string;
    session_id: string;
    service: string;
    email_selector?: string;
    password_selector?: string;
    submit_selector?: string;
  }

  /**
   * POST /api/tools/browser/login - Fill login form with stored credentials
   */
  fastify.post<{ Body: BrowserLoginBody }>(
    '/api/tools/browser/login',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, service, email_selector, password_selector, submit_selector } = request.body;

      logger.info({ tenantId: tenant_id, sessionId: session_id, service }, 'Browser login');

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        // Fetch credentials
        const email = await getCredential(tenant_id, `${service}_email`);
        const password = await getCredential(tenant_id, `${service}_password`);

        if (!email || !password) {
          const missing = [];
          if (!email) missing.push(`${service}_email`);
          if (!password) missing.push(`${service}_password`);
          throw new AppError(`Missing credentials: ${missing.join(', ')}`, 'MISSING_CREDENTIALS', 400);
        }

        // Fill form - try multiple common selectors (robust auto-detection)
        const emailSelectors = email_selector
          ? [email_selector]
          : [
              'input[type="email"]',
              'input[name="email"]',
              'input[name="username"]',
              'input[id="email"]',
              'input[id="username"]',
              'input[autocomplete="email"]',
              'input[autocomplete="username"]',
              'input[placeholder*="email" i]',
              'input[placeholder*="mail" i]',
              'input[name="account"]',
              'input[id="account"]',
              'input:not([type="password"]):not([type="hidden"]):not([type="submit"])',
            ];

        const passSelectors = password_selector
          ? [password_selector]
          : [
              'input[type="password"]',
              'input[name="password"]',
              'input[id="password"]',
            ];

        // Try email selectors until one works
        let emailFilled = false;
        for (const sel of emailSelectors) {
          try {
            const elem = session.page.locator(sel).first();
            if (await elem.isVisible({ timeout: 1000 })) {
              await elem.fill(email, { timeout: 5000 });
              emailFilled = true;
              logger.info({ selector: sel }, 'Email field filled');
              break;
            }
          } catch {
            // Try next selector
          }
        }
        if (!emailFilled) {
          throw new AppError('Could not find email/username field', 'SELECTOR_NOT_FOUND', 400);
        }

        // Try password selectors until one works
        let passFilled = false;
        for (const sel of passSelectors) {
          try {
            const elem = session.page.locator(sel).first();
            if (await elem.isVisible({ timeout: 1000 })) {
              await elem.fill(password, { timeout: 5000 });
              passFilled = true;
              logger.info({ selector: sel }, 'Password field filled');
              break;
            }
          } catch {
            // Try next selector
          }
        }
        if (!passFilled) {
          throw new AppError('Could not find password field', 'SELECTOR_NOT_FOUND', 400);
        }

        // Submit if selector provided
        if (submit_selector) {
          await session.page.click(submit_selector, { timeout: 10000 });
          await session.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        }

        return reply.send({
          success: true,
          message: submit_selector ? 'Login form filled and submitted' : 'Login form filled',
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser login failed');
        throw new AppError(`Browser login failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserClickBody {
    tenant_id: string;
    session_id: string;
    selector: string;
  }

  /**
   * POST /api/tools/browser/click - Click an element
   */
  fastify.post<{ Body: BrowserClickBody }>(
    '/api/tools/browser/click',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, selector } = request.body;

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        await session.page.click(selector, { timeout: 10000 });

        return reply.send({
          success: true,
          message: `Clicked: ${selector}`,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser click failed');
        throw new AppError(`Browser click failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserTypeBody {
    tenant_id: string;
    session_id: string;
    selector: string;
    text: string;
    clear?: boolean;
  }

  /**
   * POST /api/tools/browser/type - Type text into an element
   */
  fastify.post<{ Body: BrowserTypeBody }>(
    '/api/tools/browser/type',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, selector, text, clear } = request.body;

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        if (clear) {
          await session.page.fill(selector, text, { timeout: 10000 });
        } else {
          await session.page.type(selector, text, { timeout: 10000 });
        }

        return reply.send({
          success: true,
          message: `Typed into: ${selector}`,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser type failed');
        throw new AppError(`Browser type failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserReadBody {
    tenant_id: string;
    session_id: string;
    selector?: string;
    max_length?: number;
  }

  /**
   * POST /api/tools/browser/read - Read page content
   */
  fastify.post<{ Body: BrowserReadBody }>(
    '/api/tools/browser/read',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, selector, max_length } = request.body;

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        let content: string;
        if (selector) {
          content = await session.page.locator(selector).first().textContent({ timeout: 10000 }) || '';
        } else {
          content = await session.page.locator('body').textContent({ timeout: 10000 }) || '';
        }

        // Truncate if needed
        const maxLen = max_length || 50000;
        if (content.length > maxLen) {
          content = content.substring(0, maxLen) + '... (truncated)';
        }

        return reply.send({
          success: true,
          url: session.page.url(),
          title: await session.page.title(),
          content: content.trim(),
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser read failed');
        throw new AppError(`Browser read failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserScreenshotBody {
    tenant_id: string;
    session_id: string;
    filename?: string;
  }

  /**
   * POST /api/tools/browser/screenshot - Take a screenshot
   */
  fastify.post<{ Body: BrowserScreenshotBody }>(
    '/api/tools/browser/screenshot',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, filename } = request.body;

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        // Save to tenant folder
        const tenantFolder = path.resolve(process.cwd(), 'tenants', tenant_id);
        const screenshotDir = path.join(tenantFolder, 'screenshots');
        await fs.promises.mkdir(screenshotDir, { recursive: true });

        const fname = filename || `screenshot_${Date.now()}.png`;
        const filepath = path.join(screenshotDir, fname);

        await session.page.screenshot({ path: filepath, fullPage: true });

        return reply.send({
          success: true,
          path: filepath,
          filename: fname,
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser screenshot failed');
        throw new AppError(`Browser screenshot failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserCloseBody {
    tenant_id: string;
    session_id: string;
  }

  /**
   * POST /api/tools/browser/close - Close a browser session
   */
  fastify.post<{ Body: BrowserCloseBody }>(
    '/api/tools/browser/close',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id } = request.body;

      try {
        const closed = await browserSessionManager.closeSession(tenant_id, session_id);

        if (!closed) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        return reply.send({
          success: true,
          message: 'Browser session closed',
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser close failed');
        throw new AppError(`Browser close failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );

  interface BrowserListBody {
    tenant_id: string;
  }

  /**
   * POST /api/tools/browser/list - List browser sessions
   */
  fastify.post<{ Body: BrowserListBody }>(
    '/api/tools/browser/list',
    async (request, reply) => {
      const { tenant_id } = request.body;

      const sessions = browserSessionManager.listSessions(tenant_id);

      return reply.send({
        success: true,
        sessions: sessions.map(s => ({
          id: s.id,
          created_at: s.createdAt,
          last_used_at: s.lastUsedAt,
          persistent: s.persistent,
        })),
      });
    }
  );

  interface BrowserWaitBody {
    tenant_id: string;
    session_id: string;
    selector?: string;
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout?: number;
  }

  /**
   * POST /api/tools/browser/wait - Wait for element or page state
   */
  fastify.post<{ Body: BrowserWaitBody }>(
    '/api/tools/browser/wait',
    async (request, reply) => {
      const logger = createRequestLogger(request.requestId);
      const { tenant_id, session_id, selector, state, timeout } = request.body;

      try {
        const session = await browserSessionManager.getSession(tenant_id, session_id);
        if (!session) {
          throw new AppError(`Session ${session_id} not found`, 'SESSION_NOT_FOUND', 404);
        }

        const timeoutMs = timeout || 30000;

        if (selector) {
          await session.page.waitForSelector(selector, {
            state: state || 'visible',
            timeout: timeoutMs,
          });
          return reply.send({
            success: true,
            message: `Element found: ${selector}`,
          });
        } else {
          await session.page.waitForLoadState('networkidle', { timeout: timeoutMs });
          return reply.send({
            success: true,
            message: 'Page load complete',
          });
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        const err = error as Error;
        logger.error({ error: err.message }, 'Browser wait failed');
        throw new AppError(`Browser wait failed: ${err.message}`, 'BROWSER_ERROR', 500);
      }
    }
  );
};
