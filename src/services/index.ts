import { getConfig } from '../config/index.js';
import { ClaudeCliService } from './claudeCli.js';
import { WhatsAppService } from './whatsapp.js';
import { TelegramService } from './messaging/telegram.js';
import { MessagingServiceResolver } from './messaging/resolver.js';
import { TenantDirectivesService } from './tenantDirectives.js';
import { TenantFolderService } from './tenantFolder.js';
import { PythonRunnerService } from './pythonRunner.js';
import { MessageProcessor } from './messageProcessor.js';
import { SchedulerService } from './schedulerService.js';
import { PrismaTenantResolver, TenantResolver } from './tenant.js';
import { getPrismaClient } from './prisma.js';
import { toolRegistry, registerAllTools } from '../tools/index.js';
import { setTenantDirectivesService } from '../tools/readDirective.js';
import { logger } from '../utils/logger.js';
import { ToolExecutionTracker } from './toolExecutionTracker.js';
import { FeedbackCollector } from './feedbackCollector.js';
import { PatternAnalyzer } from './patternAnalyzer.js';
import { SelfImprovementService } from './selfImprovement.js';
import { ImprovementScheduler } from './improvementScheduler.js';
import { TriggerEvaluatorService } from './triggerEvaluator.js';
import { WebhookReceiverAdapter, ConditionPollingAdapter, EmailPollingAdapter, OutlookPollingAdapter } from './adapters/index.js';
import { browserSessionManager } from './browserSessionManager.js';
import { LearningService } from './learningService.js';
import { LearningScheduler } from './learningScheduler.js';
import { TimelineService } from './timelineService.js';
import { CampaignService } from './campaignService.js';
import { ApprovalQueueService } from './approvalQueueService.js';
import { UnsubscribeService } from './unsubscribeService.js';
import { CampaignScheduler } from './campaignScheduler.js';
import {
  startWorker,
  stopWorker,
  setSendMessageFn,
  startDedupCleanup,
  stopDedupCleanup,
  interruptAllJobs,
  shutdownQueue,
  isRedisHealthy,
} from './queue/index.js';
import { closeAllSessions as closeAllCliSessions } from './queue/cliSessionStore.js';

// Re-export getPrismaClient for use in routes
export { getPrismaClient } from './prisma.js';

let messageProcessor: MessageProcessor | null = null;
let triggerEvaluatorInstance: TriggerEvaluatorService | null = null;
let webhookAdapterInstance: WebhookReceiverAdapter | null = null;
let tenantResolver: TenantResolver | null = null;
let schedulerService: SchedulerService | null = null;
let whatsappServiceInstance: WhatsAppService | null = null;
let telegramServiceInstance: TelegramService | null = null;
let messagingResolverInstance: MessagingServiceResolver | null = null;
let tenantFolderServiceInstance: TenantFolderService | null = null;
let toolExecutionTrackerInstance: ToolExecutionTracker | null = null;
let feedbackCollectorInstance: FeedbackCollector | null = null;
let patternAnalyzerInstance: PatternAnalyzer | null = null;
let selfImprovementInstance: SelfImprovementService | null = null;
let improvementSchedulerInstance: ImprovementScheduler | null = null;
let claudeCliServiceInstance: ClaudeCliService | null = null;
let pythonRunnerServiceInstance: PythonRunnerService | null = null;
let learningServiceInstance: LearningService | null = null;
let learningSchedulerInstance: LearningScheduler | null = null;
let timelineServiceInstance: TimelineService | null = null;
let campaignServiceInstance: CampaignService | null = null;
let approvalQueueServiceInstance: ApprovalQueueService | null = null;
let unsubscribeServiceInstance: UnsubscribeService | null = null;
let campaignSchedulerInstance: CampaignScheduler | null = null;

/**
 * Initialize all services. Call this once at startup.
 */
export function initializeServices(): void {
  const config = getConfig();
  const prisma = getPrismaClient();

  // Register all tools (used by tool registry for shared tools)
  registerAllTools();
  logger.info({ registeredTools: toolRegistry.getToolNames() }, 'Tools registered');

  // Initialize services
  whatsappServiceInstance = new WhatsAppService({
    accessToken: config.whatsapp.accessToken,
    phoneNumberId: config.whatsapp.phoneNumberId,
  });

  // Initialize Telegram service if configured
  if (config.telegram?.botToken) {
    telegramServiceInstance = new TelegramService({
      botToken: config.telegram.botToken,
    });
    logger.info('Telegram service initialized');
  } else {
    logger.info('Telegram service not configured (TELEGRAM_BOT_TOKEN not set)');
  }

  // Initialize messaging service resolver for multi-channel support
  messagingResolverInstance = new MessagingServiceResolver(
    prisma,
    whatsappServiceInstance,
    telegramServiceInstance
  );

  // Initialize tenant-specific services
  const tenantDirectivesService = new TenantDirectivesService();
  pythonRunnerServiceInstance = new PythonRunnerService();

  // Initialize Claude CLI service for agent mode (default: 30 min timeout)
  const claudeCliTimeoutMs = parseInt(process.env.CLAUDE_CLI_TIMEOUT_MS || '1800000', 10);
  claudeCliServiceInstance = new ClaudeCliService(claudeCliTimeoutMs);

  // Initialize tenant folder service for CLI mode setup
  tenantFolderServiceInstance = new TenantFolderService();

  // Initialize timeline service for daily journal logging
  timelineServiceInstance = new TimelineService();

  // Log CLI mode configuration
  const globalCliEnabled = process.env.USE_CLAUDE_CLI === 'true';
  logger.info(
    {
      globalCliEnabled,
      claudeCliTimeoutMs,
    },
    'Claude CLI service initialized'
  );

  // Set tenant directives service for read_directive tool
  setTenantDirectivesService(tenantDirectivesService);

  logger.info('Tenant services initialized (tenantDirectives, pythonRunner, claudeCli, tenantFolder)');

  // Initialize learning service for end-of-conversation reflection
  learningServiceInstance = new LearningService(claudeCliServiceInstance);
  logger.info('Learning service initialized');

  // Initialize message processor with tenant services and Claude CLI
  messageProcessor = new MessageProcessor(
    prisma,
    whatsappServiceInstance,
    claudeCliServiceInstance,
    tenantFolderServiceInstance,
    messagingResolverInstance,
    learningServiceInstance,
    timelineServiceInstance
  );

  // Initialize tenant resolver
  tenantResolver = new PrismaTenantResolver(prisma);

  // Initialize and start scheduler service (DOE-compliant: Claude orchestrates, tools execute)
  schedulerService = new SchedulerService(prisma, messageProcessor, whatsappServiceInstance, messagingResolverInstance);
  schedulerService.start();
  logger.info('Scheduler service initialized and started');

  // Initialize trigger evaluator service and adapters
  triggerEvaluatorInstance = new TriggerEvaluatorService(prisma, messageProcessor, whatsappServiceInstance, messagingResolverInstance);

  // Create and register adapters
  webhookAdapterInstance = new WebhookReceiverAdapter(prisma);
  const conditionAdapter = new ConditionPollingAdapter(prisma);
  const emailAdapter = new EmailPollingAdapter(prisma);
  const outlookAdapter = new OutlookPollingAdapter(prisma);

  triggerEvaluatorInstance.registerAdapter(webhookAdapterInstance);
  triggerEvaluatorInstance.registerAdapter(conditionAdapter);
  triggerEvaluatorInstance.registerAdapter(emailAdapter);
  triggerEvaluatorInstance.registerAdapter(outlookAdapter);

  // Start trigger evaluator (starts all adapters)
  triggerEvaluatorInstance.start().catch((error) => {
    logger.error({ error }, 'Failed to start trigger evaluator');
  });
  logger.info('Trigger evaluator service initialized');

  // Initialize self-annealing services
  toolExecutionTrackerInstance = new ToolExecutionTracker(prisma);
  feedbackCollectorInstance = new FeedbackCollector(prisma);
  patternAnalyzerInstance = new PatternAnalyzer(prisma);
  selfImprovementInstance = new SelfImprovementService(prisma, patternAnalyzerInstance);
  improvementSchedulerInstance = new ImprovementScheduler(prisma, selfImprovementInstance);
  logger.info('Self-annealing services initialized');

  // Initialize and start learning scheduler (periodic learning reviews)
  learningSchedulerInstance = new LearningScheduler(prisma, learningServiceInstance);
  learningSchedulerInstance.start();
  logger.info('Learning scheduler initialized and started');

  // Initialize campaign services
  campaignServiceInstance = new CampaignService();
  approvalQueueServiceInstance = new ApprovalQueueService();
  unsubscribeServiceInstance = new UnsubscribeService();
  campaignSchedulerInstance = new CampaignScheduler(
    prisma,
    campaignServiceInstance,
    approvalQueueServiceInstance,
    unsubscribeServiceInstance,
    timelineServiceInstance
  );
  campaignSchedulerInstance.start();
  logger.info('Campaign services initialized and scheduler started (15-minute cycle)');

  // Start browser session manager (cleanup interval)
  browserSessionManager.start();
  logger.info('Browser session manager started');

  // Initialize async task queue (BullMQ + Redis)
  // Set up send message function for worker to send responses
  const sendMessageFn = async (tenantId: string, senderPhone: string, message: string): Promise<string> => {
    if (messagingResolverInstance) {
      const service = await messagingResolverInstance.resolveForTenant(tenantId);
      const recipientId = await messagingResolverInstance.getRecipientId(tenantId, senderPhone);
      return service.sendTextMessage(recipientId, message);
    }
    return whatsappServiceInstance!.sendTextMessage(senderPhone, message);
  };
  setSendMessageFn(sendMessageFn);

  // Start dedup cleanup interval
  startDedupCleanup();

  // Start queue worker (if Redis is available)
  isRedisHealthy().then((healthy) => {
    if (healthy) {
      const worker = startWorker();
      if (worker) {
        logger.info('Async task queue worker started');
      }
    } else {
      logger.warn('Redis not available, async task queue disabled (tasks will run synchronously)');
    }
  }).catch((error) => {
    logger.warn({ error }, 'Failed to check Redis health, async task queue disabled');
  });
}

/**
 * Get the message processor. Must call initializeServices first.
 */
export function getMessageProcessor(): MessageProcessor {
  if (!messageProcessor) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return messageProcessor;
}

/**
 * Get the tenant resolver. Must call initializeServices first.
 */
export function getTenantResolver(): TenantResolver {
  if (!tenantResolver) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return tenantResolver;
}

/**
 * Get the scheduler service. Must call initializeServices first.
 */
export function getSchedulerService(): SchedulerService {
  if (!schedulerService) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return schedulerService;
}

/**
 * Stop the scheduler service. Call during graceful shutdown.
 */
export async function stopSchedulerService(): Promise<void> {
  if (schedulerService) {
    await schedulerService.stop();
    logger.info('Scheduler service stopped');
  }
}

/**
 * Gracefully shutdown all services. Call during application shutdown.
 * Waits for in-flight operations and cleans up resources.
 */
export async function shutdownServices(): Promise<void> {
  logger.info('Shutting down services...');

  // 1. Stop scheduler (waits for in-flight tasks)
  if (schedulerService) {
    try {
      await schedulerService.stop();
      logger.info('Scheduler service stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping scheduler service');
    }
  }

  // 1.5. Stop trigger evaluator (stops all adapters)
  if (triggerEvaluatorInstance) {
    try {
      await triggerEvaluatorInstance.stop();
      logger.info('Trigger evaluator service stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping trigger evaluator service');
    }
  }

  // 2. Stop improvement scheduler
  if (improvementSchedulerInstance) {
    try {
      improvementSchedulerInstance.stop();
      logger.info('Improvement scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping improvement scheduler');
    }
  }

  // 2.5. Stop learning scheduler
  if (learningSchedulerInstance) {
    try {
      learningSchedulerInstance.stop();
      logger.info('Learning scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping learning scheduler');
    }
  }

  // 2.55. Stop campaign scheduler
  if (campaignSchedulerInstance) {
    try {
      await campaignSchedulerInstance.stop();
      logger.info('Campaign scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping campaign scheduler');
    }
  }

  // 2.6. Stop async task queue
  try {
    stopDedupCleanup();
    const interruptedCount = await interruptAllJobs('shutdown');
    if (interruptedCount > 0) {
      logger.info({ interruptedCount }, 'Interrupted running async jobs');
    }
    await stopWorker();
    await shutdownQueue();
    logger.info('Async task queue stopped');
  } catch (error) {
    logger.error({ error }, 'Error stopping async task queue');
  }

  // 2.7. Close all CLI sessions (stream-json sessions)
  try {
    const closedCount = await closeAllCliSessions();
    if (closedCount > 0) {
      logger.info({ closedCount }, 'Closed CLI sessions');
    }
  } catch (error) {
    logger.error({ error }, 'Error closing CLI sessions');
  }

  // 3. Stop Claude CLI service (kill active processes)
  if (claudeCliServiceInstance) {
    try {
      claudeCliServiceInstance.stop();
      logger.info('Claude CLI service stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Claude CLI service');
    }
  }

  // 4. Stop Python runner (kill active processes)
  if (pythonRunnerServiceInstance) {
    try {
      pythonRunnerServiceInstance.killAllProcesses();
      logger.info('Python runner processes killed');
    } catch (error) {
      logger.error({ error }, 'Error stopping Python runner');
    }
  }

  // 5. Stop browser session manager (close all browsers)
  try {
    await browserSessionManager.closeAllSessions();
    browserSessionManager.stop();
    logger.info('Browser session manager stopped');
  } catch (error) {
    logger.error({ error }, 'Error stopping browser session manager');
  }

  // 6. Disconnect Prisma
  try {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
    logger.info('Prisma disconnected');
  } catch (error) {
    logger.error({ error }, 'Error disconnecting Prisma');
  }

  logger.info('All services shutdown complete');
}

/**
 * Get the WhatsApp service. Must call initializeServices first.
 */
export function getWhatsAppService(): WhatsAppService {
  if (!whatsappServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return whatsappServiceInstance;
}

/**
 * Get the tenant folder service. Must call initializeServices first.
 */
export function getTenantFolderService(): TenantFolderService {
  if (!tenantFolderServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return tenantFolderServiceInstance;
}

/**
 * Get the tool execution tracker. Must call initializeServices first.
 */
export function getToolExecutionTracker(): ToolExecutionTracker {
  if (!toolExecutionTrackerInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return toolExecutionTrackerInstance;
}

/**
 * Get the feedback collector. Must call initializeServices first.
 */
export function getFeedbackCollector(): FeedbackCollector {
  if (!feedbackCollectorInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return feedbackCollectorInstance;
}

/**
 * Get the improvement scheduler. Must call initializeServices first.
 */
export function getImprovementScheduler(): ImprovementScheduler {
  if (!improvementSchedulerInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return improvementSchedulerInstance;
}

/**
 * Get the learning scheduler. Must call initializeServices first.
 */
export function getLearningScheduler(): LearningScheduler {
  if (!learningSchedulerInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return learningSchedulerInstance;
}

/**
 * Get the learning service. Must call initializeServices first.
 */
export function getLearningService(): LearningService {
  if (!learningServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return learningServiceInstance;
}

/**
 * Get the trigger evaluator service. Must call initializeServices first.
 */
export function getTriggerEvaluator(): TriggerEvaluatorService {
  if (!triggerEvaluatorInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return triggerEvaluatorInstance;
}

/**
 * Get the webhook adapter. Must call initializeServices first.
 */
export function getWebhookAdapter(): WebhookReceiverAdapter {
  if (!webhookAdapterInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return webhookAdapterInstance;
}

/**
 * Get the Telegram service. Returns null if not configured.
 */
export function getTelegramService(): TelegramService | null {
  return telegramServiceInstance;
}

/**
 * Get the messaging service resolver. Must call initializeServices first.
 */
export function getMessagingResolver(): MessagingServiceResolver {
  if (!messagingResolverInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return messagingResolverInstance;
}

/**
 * Get the timeline service. Must call initializeServices first.
 */
export function getTimelineService(): TimelineService {
  if (!timelineServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return timelineServiceInstance;
}

/**
 * Get the campaign service. Must call initializeServices first.
 */
export function getCampaignService(): CampaignService {
  if (!campaignServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return campaignServiceInstance;
}

/**
 * Get the approval queue service. Must call initializeServices first.
 */
export function getApprovalQueueService(): ApprovalQueueService {
  if (!approvalQueueServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return approvalQueueServiceInstance;
}

/**
 * Get the unsubscribe service. Must call initializeServices first.
 */
export function getUnsubscribeService(): UnsubscribeService {
  if (!unsubscribeServiceInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return unsubscribeServiceInstance;
}

/**
 * Get the campaign scheduler. Must call initializeServices first.
 */
export function getCampaignScheduler(): CampaignScheduler {
  if (!campaignSchedulerInstance) {
    throw new Error('Services not initialized. Call initializeServices() first.');
  }
  return campaignSchedulerInstance;
}
