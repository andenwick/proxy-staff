import { createHmac } from 'crypto';
import { FastifyInstance } from 'fastify';

// Set test environment variables before importing modules
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-ok';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789';

// Import after setting env vars
import { buildServer } from '../server';

describe('API Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /health', () => {
    it('returns status, timestamp, and version', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
      expect(typeof body.timestamp).toBe('string');
      expect(body.version).toBeDefined();
      expect(typeof body.version).toBe('string');
    });
  });

  describe('GET /webhooks/whatsapp', () => {
    it('returns challenge on valid verify_token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': 'test-challenge-123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('test-challenge-123');
    });

    it('returns 403 on invalid verify_token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'test-challenge-123',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /webhooks/whatsapp', () => {
    const testPayload = {
      object: 'whatsapp_business_account',
      entry: [{ id: '123', changes: [] }],
    };

    function createSignature(body: string, secret: string): string {
      const hmac = createHmac('sha256', secret);
      hmac.update(body);
      return 'sha256=' + hmac.digest('hex');
    }

    it('rejects invalid signature with 401', async () => {
      const body = JSON.stringify(testPayload);
      const invalidSignature = 'sha256=invalidsignature';

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': invalidSignature,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts valid signature', async () => {
      const body = JSON.stringify(testPayload);
      const signature = createSignature(body, 'test-app-secret');

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
