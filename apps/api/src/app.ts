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
import { ByokLlmRegistry, type ByokLlmResolver } from './llm/byok';
import { createEventBus, type EventBus } from './bus/event-bus';
import { sseRoute } from './bus/sse-route';
import type { EventOrchestrator } from './orchestrator/EventOrchestrator';
import { approvalRoutes } from './routes/approvals';
import { metricsRoutes } from './routes/metrics';
import { x402Routes } from './x402/routes';
import { askRoutes } from './routes/ask';
import { sandboxRoutes } from './routes/sandbox';
import { complianceRoutes } from './compliance/routes';

export interface AppDeps {
  config: Config;
  /** Injected so tests can simulate an unreachable database without a real connection. */
  probeDb: () => Promise<DbProbeResult>;
  /** Read-write pool used by the transactional webhook ingress. Null keeps health-only tests database independent. */
  db?: pg.Pool;
  /** Dedicated least-privilege pool for model-generated SQL (C-D7); tests may omit it. */
  readonlyDb?: pg.Pool | null;
  /** Future bus hook; T3 keeps it injectable until the event bus lands in T8. */
  onEvent?: (notification: IngressEventNotification) => void | Promise<void>;
  /** Override the logger (tests pass `false`). */
  logger?: FastifyServerOptions['logger'];
  /** Inject a client in tests or in a larger boot composition; production defaults to the factory. */
  llm?: LlmClient;
  /** Shared process-local bus used by ingress notifications, the orchestrator, and SSE clients. */
  bus?: EventBus;
  orchestrator?: EventOrchestrator;
  /**
   * Sandbox / BYOK (T25): resolves a caller's `x-aegis-llm-key` to a client bound to that key. `server.ts` shares one
   * registry between the routes and the worker so a manual compliance scan can run on the key that triggered it;
   * tests inject a fake, and the default builds a registry from `config`.
   */
  byok?: ByokLlmResolver;
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

  // Intent: the dashboard is a browser client on another origin, so CORS decides what it can actually do (B-016).
  //         `methods` must name PUT (guardrail edits) and `exposedHeaders` must name X-PAYMENT-RESPONSE, or the browser
  //         silently blocks the request / hides the header while curl keeps working.
  await app.register(cors, {
    origin: [config.WEB_ORIGIN],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    exposedHeaders: ['X-PAYMENT-RESPONSE'],
  });
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
  const byok = deps.byok ?? new ByokLlmRegistry({ config, logger: app.log });
  await app.register(systemRoutes, { llm, env: config.NODE_ENV, version: AEGIS_VERSION });
  if (deps.db) {
    await app.register(askRoutes, { db: deps.db, readonlyDb: deps.readonlyDb, llm, byok });
    await app.register(complianceRoutes, { db: deps.db, byok });
    await app.register(sandboxRoutes, { db: deps.db });
    await app.register(x402Routes, { db: deps.db, config, bus });
    await app.register(metricsRoutes, { db: deps.db });
    // The bus is required here: a kill-switch change is published on it, and every dashboard listens (B-017, C-B5).
    if (deps.orchestrator) await app.register(approvalRoutes, { db: deps.db, orchestrator: deps.orchestrator, bus });
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
    await app.register(simRoutes, { prefix: '/api/v1', config: { RAZORPAY_WEBHOOK_SECRET: config.RAZORPAY_WEBHOOK_SECRET, X402_SIM_SECRET: config.X402_SIM_SECRET, X402_PAY_TO: config.X402_PAY_TO }, db: deps.db ?? null });
  }
  return app;
}

/**
 * Log paths that must never reach a log line (C-D4).
 * Intent: pino's `*` matches exactly one level, so a bare key and a one-level-nested key are different paths. Both are
 *         listed for every PII field, and `card.number` is listed at both depths, because the constraint names it and
 *         a pan in a log file is the one leak that cannot be walked back.
 * Flow: request headers that carry credentials -> the PII fields at the top level -> the same fields one level in.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-razorpay-signature"]',
  'req.headers["x-payment"]',
  'req.headers["x-aegis-llm-key"]',
  'email',
  'contact',
  'phone',
  'card.number',
  '*.email',
  '*.contact',
  '*.phone',
  '*.card.number',
] as const;

function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    // PII never reaches the logs (Constraints C-D4). Extend these paths when new fields appear.
    redact: {
      paths: [...LOG_REDACT_PATHS],
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
  // Intent: route handlers use zod for request contracts; malformed input is a client error, not an internal outage.
  // Flow: preserve Fastify's explicit status when present -> classify ZodError as 400 -> default unknown failures to 500.
  const zodValidation = error instanceof Error && error.name === 'ZodError';
  const status = statusCode !== undefined && statusCode >= 400 ? statusCode : zodValidation ? 400 : 500;
  return { status, code: code?.toLowerCase() ?? (zodValidation ? 'validation_error' : 'request_error'), message };
}
