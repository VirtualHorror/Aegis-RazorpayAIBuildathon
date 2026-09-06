import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { migrationStatus } from './db/migrate';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from './db/paths';
import { createPools, probeDatabase } from './db/pool';
import { createRegistry } from './worker/registry';
import { processEventHandler } from './worker/process-event';
import { startWorker } from './worker/job-runner';
import { createLlmClient } from './llm/factory';
import { ByokLlmRegistry } from './llm/byok';
import { createEventBus } from './bus/event-bus';
import { EventOrchestrator } from './orchestrator/EventOrchestrator';
import { createModuleRegistry } from './orchestrator/registry';
import { createComplianceScanHandler, startComplianceCron } from './compliance/worker';
import { dunningRetryHandler } from './modules/subscription-salvager';
import { negotiationExpiryHandler } from './modules/b2b-negotiator';

/**
 * Process entry point.
 * Flow (Flow.md F1): .env → config → pools → pending-migrations check → app → listen → (worker, Task 4) → graceful shutdown.
 */

async function main(): Promise<void> {
  loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
  const config = loadConfig();

  // The pool error callback needs the app logger, which does not exist yet when the pools are created.
  const appRef: { current?: Awaited<ReturnType<typeof buildApp>> } = {};
  const pools = createPools(config, (error, pool) => {
    appRef.current?.log.error({ err: error, pool }, 'idle database client error');
  });
  const llm = createLlmClient(config);
  // Sandbox / BYOK (T25): one registry so a key remembered by a route is visible to the worker in this same process.
  const byok = new ByokLlmRegistry({ config });
  const bus = createEventBus();
  const modules = createModuleRegistry({ disabled: config.AEGIS_MODULES_DISABLED, db: pools.rw, llm });
  // Intent: construct the orchestrator before route registration so the production approval endpoints use the same
  // module registry and execution path as the worker.
  // Flow: create pools/LLM/bus -> construct orchestrator -> build the app with approval routes -> start worker.
  const orchestrator = new EventOrchestrator({
    db: pools.rw,
    llm,
    bus,
    modules,
    logger: {
      info: (...args) => relayLog(appRef.current?.log.info, args),
      warn: (...args) => relayLog(appRef.current?.log.warn, args),
      error: (...args) => relayLog(appRef.current?.log.error, args),
      debug: (...args) => relayLog(appRef.current?.log.debug, args),
    },
  });
  const app = await buildApp({
    config,
    db: pools.rw,
    // Intent: route model-authored SQL through the least-privilege role, never the read-write application pool.
    // Flow: createPools -> buildApp passes readonlyDb -> AskService wraps each query in a timed read-only transaction.
    readonlyDb: pools.readonly,
    probeDb: () => probeDatabase(pools.rw),
    llm,
    bus,
    orchestrator,
    byok,
  });
  appRef.current = app;

  // Intent: refuse to serve stale schema by accident, but keep booting (degraded) when the DB is simply unreachable.
  try {
    const status = await migrationStatus(pools.rw, MIGRATIONS_DIR);
    if (status.pending.length > 0 && !config.AEGIS_ALLOW_PENDING_MIGRATIONS) {
      app.log.error({ pending: status.pending.map((m) => `${m.version}_${m.name}`) }, 'pending migrations — run `pnpm db:migrate` (or set AEGIS_ALLOW_PENDING_MIGRATIONS=true)');
      await pools.end();
      process.exit(1);
    }
  } catch (error) {
    app.log.warn({ err: error }, 'database unreachable at boot; serving in degraded mode');
  }

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  app.log.info(`aegis api listening on http://${config.API_HOST}:${config.API_PORT}`);

  const worker = config.AEGIS_WORKER_ENABLED
    ? startWorker({
        pools,
        logger: app.log,
        handlers: createRegistry({
          process_event: async (job, context) => processEventHandler(job, { ...context, orchestrator }),
          compliance_scan: createComplianceScanHandler(llm, bus, byok),
          dunning_retry: async (job, context) => dunningRetryHandler(job, { ...context, orchestrator }),
          negotiation_expiry: negotiationExpiryHandler,
        }),
        concurrency: config.WORKER_CONCURRENCY,
        pollIntervalMs: config.WORKER_POLL_MS,
      })
    : undefined;
  if (!worker) app.log.info('aegis worker disabled by AEGIS_WORKER_ENABLED=false');
  const complianceCron = config.AEGIS_COMPLIANCE_CRON
    ? startComplianceCron(pools.rw, app.log)
    : undefined;

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    // Flow: stop accepting → (drain worker, Task 4) → close pools → exit. Hard cap 10 s so a hung query cannot block exit.
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    await app.close();
    await worker?.stop();
    complianceCron?.stop();
    await pools.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});

function relayLog(fn: ((...args: never[]) => void) | undefined, args: unknown[]): void {
  if (fn) fn(...(args as never[]));
}
