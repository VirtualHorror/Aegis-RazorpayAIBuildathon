import type { FastifyPluginAsync } from 'fastify';
import type { EventBus } from './event-bus';

export interface SseRouteOptions {
  readonly bus: EventBus;
  readonly heartbeatMs?: number;
  /** The only browser origin allowed to consume the dashboard stream. */
  readonly webOrigin?: string;
}

/** Stream committed bus events to dashboard clients using the standard Server-Sent Events framing. */
export const sseRoute: FastifyPluginAsync<SseRouteOptions> = async (app, options) => {
  app.get('/api/v1/stream', async (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(options.webOrigin ? { 'access-control-allow-origin': options.webOrigin, vary: 'Origin' } : {}),
    });

    let closed = false;
    const query = request.query as Record<string, unknown>;
    const once = query.once === '1' || query.once === true;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    const unsubscribe = options.bus.subscribe((event) => {
      if (closed || raw.destroyed) return;
      raw.write(`event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (once) {
        cleanup();
        raw.end();
      }
    });
    const heartbeat = setInterval(() => {
      if (closed || raw.destroyed) {
        cleanup();
        return;
      }
      raw.write(': ping\n\n');
    }, options.heartbeatMs ?? 15_000);
    heartbeat.unref();
    raw.write(': connected\n\n');
    request.raw.once('close', cleanup);
    raw.once('close', cleanup);
    // `once=1` is a finite stream hook for app.inject and smoke probes; normal dashboard clients omit it and stay open.
  });
};

export default sseRoute;
