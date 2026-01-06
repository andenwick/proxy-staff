import { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'crypto';

// Extend Fastify request type to include requestId
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const requestIdPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.requestId = randomUUID();
  });
};

// Use fastify-plugin to ensure the decorator is accessible across encapsulation boundaries
export const requestIdPlugin = fp(requestIdPluginAsync, {
  name: 'request-id-plugin',
});
