import { FastifyPluginAsync } from 'fastify';
import { snapshotMetrics } from '../utils/metrics.js';

export const metricsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/metrics', async (_request, reply) => {
    return reply.send(snapshotMetrics());
  });
};
