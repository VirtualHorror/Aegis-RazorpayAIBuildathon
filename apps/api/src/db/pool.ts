import pg from 'pg';
import './pg-types';

/**
 * Connection pools.
 * Intent: one read-write pool for the application and one read-only pool (separate PostgreSQL role) reserved for
 *         AI-generated SQL (Architecture.md §11). Pools are lazy: creating them never touches the network.
 * Flow:   createPools(config) at boot → passed explicitly to builders → pools.end() on shutdown.
 */

export interface PoolConfig {
  DATABASE_URL: string;
  DATABASE_URL_READONLY?: string | undefined;
}

export interface Pools {
  readonly rw: pg.Pool;
  readonly readonly: pg.Pool | null;
  end(): Promise<void>;
}

export type DbProbeResult = { ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string };

export function createPools(config: PoolConfig, onError: (error: Error, pool: 'rw' | 'readonly') => void = () => {}): Pools {
  const common: pg.PoolConfig = {
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: 'aegis-api',
  };
  const rw = new pg.Pool({ ...common, connectionString: config.DATABASE_URL, max: 10 });
  const readonly = config.DATABASE_URL_READONLY
    ? new pg.Pool({ ...common, connectionString: config.DATABASE_URL_READONLY, max: 4, statement_timeout: 5_000 })
    : null;

  // Intent: an idle client erroring (server restart, network blip) must not crash the process.
  rw.on('error', (error) => onError(error, 'rw'));
  readonly?.on('error', (error) => onError(error, 'readonly'));

  return {
    rw,
    readonly,
    end: async () => {
      await Promise.all([rw.end(), readonly?.end()]);
    },
  };
}

/** `SELECT 1` with a hard timeout, so /health answers even when the database is unreachable or hanging. */
export async function probeDatabase(pool: pg.Pool, timeoutMs = 1_500): Promise<DbProbeResult> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database probe timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
