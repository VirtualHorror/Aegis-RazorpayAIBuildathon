import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type pg from 'pg';
import { AEGIS_VERSION } from '@aegis/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { DbProbeResult } from './db/pool';
import { ingressPlugin } from './ingress';
import type { IngressEventNotification } from './ingress/razorpay-webhook';
import { healthRoutes } from './routes/health';
import { simRoutes } from './routes/sim';
import { systemRoutes } from './routes/system';
import { createLlmClient } from './llm/factory';
import type { LlmClient } from './llm/client';
import { createEventBus, type EventBus } from './bus/event-bus';
import { sseRoute } from './bus/sse-route';
import type { EventOrchestrator } from './orchestrator/EventOrchestrator';
import { approvalRoutes } from './routes/approvals';
import { metricsRoutes } from './routes/metrics';
import { x402Routes } from './x402/routes';

export interface AppDeps {
  config: Config;
  /** Injected so tests can simulate an unreachable database without a real connection. */
  probeDb: () => Promise<DbProbeResult>;
  /** Read-write pool used by the transactional webhook ingress. Null keeps health-only tests database independent. */
  db?: pg.Pool;
  /** Future bus hook; T3 keeps it injectable until the event bus lands in T8. */
  onEvent?: (notification: IngressEventNotification) => void | Promise<void>;
  /** Override the logger (tests pass `false`). */
  logger?: FastifyServerOptions['logger'];
  /** Inject a client in tests or in a larger boot composition; production defaults to the factory. */
  llm?: LlmClient;
  /** Shared process-local bus used by ingress notifications, the orchestrator, and SSE clients. */
  bus?: EventBus;
  orchestrator?: EventOrchestrator;
}

/**
 * Build the Fastify app without listening.
 * Intent: everything (plugins, routes, error shape) is wired here so tests use `app.inject()` on the exact production app.
 * Flow:   logger → CORS (dashboard origin only) → rate limit (600/min default, per-route overrides) →
 *         error/404 handlers → health + system metadata + encapsulated ingress routes (when a DB pool is supplied).
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const bus = deps.bus ?? createEventBus();
  const app = Fastify({
    logger: deps.logger ?? loggerOptions(config),
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    trustProxy: false,
  });

  await app.register(cors, { origin: [config.WEB_ORIGIN] });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  // One error shape everywhere: { error, details?, request_id }. Validation errors keep Fastify's 400.
  app.setErrorHandler((error: unknown, request, reply) => {
    const { status, code, message } = normalizeError(error);
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    void reply.code(status).send({
      error: status >= 500 ? 'internal_error' : code,
      details: status >= 500 ? undefined : message,
      request_id: request.id,
    });
  });
  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({ error: 'not_found', details: `${request.method} ${request.url}`, request_id: request.id });
  });

  await app.register(healthRoutes, { probeDb: deps.probeDb, version: AEGIS_VERSION });
  const llm = deps.llm ?? createLlmClient(config, app.log);
  await app.register(systemRoutes, { llm });
  if (deps.db) {
    await app.register(x402Routes, { db: deps.db, config, bus });
    await app.register(metricsRoutes, { db: deps.db });
    if (deps.orchestrator) await app.register(approvalRoutes, { db: deps.db, orchestrator: deps.orchestrator });
  }
  await app.register(sseRoute, { bus, webOrigin: config.WEB_ORIGIN });
  await app.register(ingressPlugin, {
    prefix: '/webhooks',
    config,
    db: deps.db ?? null,
    onEvent: async (notification) => {
      const eventName = notification.status === 'accepted'
        ? 'event.received'
        : notification.status === 'duplicate'
          ? 'event.duplicate'
          : notification.status === 'rejected'
            ? 'event.rejected'
            : 'event.processed';
      bus.publish(eventName, notification);
      await deps.onEvent?.(notification);
    },
  });
  if (config.NODE_ENV !== 'production') {
    await app.register(simRoutes, { prefix: '/api/v1', config: { RAZORPAY_WEBHOOK_SECRET: config.RAZORPAY_WEBHOOK_SECRET }, db: deps.db ?? null });
  }
  return app;
}

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    // PII never reaches the logs (Constraints C-D4). Extend these paths when new fields appear.
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-razorpay-signature"]', '*.email', '*.contact', '*.phone'],
      censor: '[redacted]',
    },
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  };
}

/**
 * Fastify hands the error handler an `unknown`. Narrow it without casts: Fastify/HTTP errors carry a numeric
 * `statusCode` and a string `code` (e.g. FST_ERR_VALIDATION); anything else is a 500.
 */
function normalizeError(error: unknown): { status: number; code: string; message: string } {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined;
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const status = statusCode !== undefined && statusCode >= 400 ? statusCode : 500;
  return { status, code: code?.toLowerCase() ?? 'request_error', message };
}
