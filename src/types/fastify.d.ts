import 'fastify';
import { PrismaClient } from '@prisma/client';
import type { TriggerEvaluatorService } from '../services/triggerEvaluator.js';
import type { WebhookReceiverAdapter } from '../services/adapters/webhookAdapter.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    tenantId?: string;
    userPhone?: string;
  }

  interface FastifyInstance {
    prisma: PrismaClient;
    triggerEvaluator?: TriggerEvaluatorService;
    webhookAdapter?: WebhookReceiverAdapter;
  }
}
