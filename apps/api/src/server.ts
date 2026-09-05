import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { migrationStatus } from './db/migrate';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from './db/paths';
import { createPools, probeDatabase } from './db/pool';

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
  const app = await buildApp({ config, probeDb: () => probeDatabase(pools.rw) });
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

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    // Flow: stop accepting → (drain worker, Task 4) → close pools → exit. Hard cap 10 s so a hung query cannot block exit.
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    await app.close();
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
