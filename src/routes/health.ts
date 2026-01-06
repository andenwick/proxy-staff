import { FastifyPluginAsync } from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

// Read version from package.json at startup
const packageJsonPath = path.resolve(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

interface HealthResponse {
  status: 'ok';
  timestamp: string;
  version: string;
}

export const healthRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HealthResponse }>('/health', async (_request, reply) => {
    const response: HealthResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: packageJson.version || '1.0.0',
    };
    return reply.send(response);
  });
};
