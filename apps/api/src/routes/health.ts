import type { FastifyPluginAsync } from 'fastify';
import type { DbProbeResult } from '../db/pool';

export interface HealthRouteOptions {
  probeDb: () => Promise<DbProbeResult>;
  version: string;
}

/**
 * GET /health
 * Intent: the API must stay up and describable when PostgreSQL is down, so the dashboard can show the outage
 *         instead of a blank page. Hence 200 + `status: "degraded"` rather than a crash or a 5xx.
 */
export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, opts) => {
  const startedAt = Date.now();
  app.get('/health', { config: { rateLimit: false } }, async () => {
    const db = await opts.probeDb();
    return {
      status: db.ok ? 'ok' : 'degraded',
      db: db.ok ? 'ok' : 'unavailable',
      db_latency_ms: db.latencyMs,
      ...(db.ok ? {} : { error: db.error }),
      version: opts.version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  });
};
