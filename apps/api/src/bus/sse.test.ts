import { describe, expect, it } from 'vitest';
import { createEventBus } from './event-bus';
import { sseRoute } from './sse-route';
import Fastify from 'fastify';

describe('SSE event bus', () => {
  it('publishes a framed event and exposes the required stream headers', async () => {
    const app = Fastify({ logger: false });
    const bus = createEventBus();
    await app.register(sseRoute, { bus, heartbeatMs: 60_000, webOrigin: 'http://localhost:3000' });
    try {
      const responsePromise = app.inject({
        method: 'GET',
        url: '/api/v1/stream?once=1',
        headers: { origin: 'https://attacker.example' },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      bus.publish('event.received', { eventId: 'evt_sse_test' });
      const response = await responsePromise;
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['x-accel-buffering']).toBe('no');
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.body).toContain('event: event.received');
      expect(response.body).toContain('evt_sse_test');
    } finally {
      await app.close();
    }
  });
});
