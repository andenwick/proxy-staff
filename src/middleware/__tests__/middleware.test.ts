import Fastify, { FastifyInstance } from 'fastify';
import { requestIdPlugin } from '../requestId.js';
import { errorHandlerPlugin, AppError } from '../errorHandler.js';

describe('Request ID Middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(requestIdPlugin);

    app.get('/test', async (request, reply) => {
      return { requestId: request.requestId };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates UUID and attaches to request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    const body = JSON.parse(response.body);

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.requestId).toMatch(uuidRegex);
  });
});

describe('Error Handler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(requestIdPlugin);
    await app.register(errorHandlerPlugin);

    app.get('/throw-error', async () => {
      throw new AppError('Something went wrong', 'TEST_ERROR', 400);
    });

    app.get('/throw-generic', async () => {
      throw new Error('Generic error');
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns consistent error shape', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/throw-error',
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body).toHaveProperty('success', false);
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'TEST_ERROR');
    expect(body.error).toHaveProperty('message', 'Something went wrong');
  });

  it('includes request ID in error response', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/throw-error',
    });

    const body = JSON.parse(response.body);

    expect(body.error).toHaveProperty('requestId');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.error.requestId).toMatch(uuidRegex);
  });

  it('handles generic errors with 500 status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/throw-generic',
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('Server', () => {
  it('starts and responds to basic request', async () => {
    const app = Fastify();
    await app.register(requestIdPlugin);

    app.get('/ping', async () => {
      return { pong: true };
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ pong: true });

    await app.close();
  });
});
