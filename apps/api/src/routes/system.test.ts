import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { systemRoutes } from './system';

describe('GET /api/v1/system', () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('returns only the resolved public provider description', async () => {
    app = Fastify({ logger: false });
    await app.register(systemRoutes, {
      llm: {
        provider: 'stub',
        describe: () => ({ provider: 'stub', model: 'fixture-v1', modelFast: 'fixture-v1' }),
      },
      env: 'test',
      version: '0.1.0',
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: 'stub', model: 'fixture-v1', modelFast: 'fixture-v1', env: 'test', version: '0.1.0', simulated: true });
  });

  it('has a safe empty-model fallback for a minimal client', async () => {
    app = Fastify({ logger: false });
    await app.register(systemRoutes, { llm: { provider: 'test' } });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system' });

    expect(response.json()).toEqual({ provider: 'test', model: '', modelFast: '', env: 'development', version: '', simulated: true });
  });
});
