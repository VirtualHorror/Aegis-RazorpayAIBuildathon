import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type pg from 'pg';

/**
 * Plain-SQL migration runner (Decisions D-005).
 * Intent: evaluators can read every DDL statement; no ORM magic. Each migration runs in ONE transaction and is recorded
 *         with a checksum so a silently edited historical migration is detected instead of drifting.
 * Flow:   listMigrations(dir) → compare with schema_migrations → apply pending in version order (up) /
 *         run `<version>_<name>.down.sql` for the latest applied version (down).
 * File naming: `NNNN_snake_name.sql` (+ optional `NNNN_snake_name.down.sql`). NNNN is a zero-padded, unique version.
 */

export interface MigrationFile {
  version: string;
  name: string;
  path: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function listMigrations(dir: string): MigrationFile[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const seen = new Set<string>();
  return files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new MigrationError(`migration file name "${file}" must match NNNN_snake_name.sql`);
    const version = match[1] as string;
    const name = match[2] as string;
    if (seen.has(version)) throw new MigrationError(`duplicate migration version ${version} (${file})`);
    seen.add(version);
    const path = join(dir, file);
    const sql = readFileSync(path, 'utf8');
    return { version, name, path, sql, checksum: checksumOf(sql) };
  });
}

export function downFileFor(migration: Pick<MigrationFile, 'path'>): string | null {
  const down = migration.path.replace(/\.sql$/, '.down.sql');
  return existsSync(down) ? down : null;
}

async function ensureTable(client: pg.PoolClient | pg.Pool): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

export async function appliedMigrations(pool: pg.Pool): Promise<AppliedMigration[]> {
  await ensureTable(pool);
  const result = await pool.query<AppliedMigration>('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return result.rows;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
  /** Applied migrations whose file content no longer matches what was applied. */
  drifted: Array<{ version: string; name: string }>;
}

export async function migrationStatus(pool: pg.Pool, dir: string): Promise<MigrationStatus> {
  const files = listMigrations(dir);
  const applied = await appliedMigrations(pool);
  const appliedByVersion = new Map(applied.map((m) => [m.version, m]));
  const pending = files.filter((f) => !appliedByVersion.has(f.version));
  const drifted = files
    .filter((f) => appliedByVersion.has(f.version) && appliedByVersion.get(f.version)?.checksum !== f.checksum)
    .map((f) => ({ version: f.version, name: f.name }));
  return { applied, pending, drifted };
}

export interface MigrationLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export async function migrateUp(pool: pg.Pool, dir: string, log: MigrationLogger): Promise<{ applied: string[] }> {
  const status = await migrationStatus(pool, dir);
  if (status.drifted.length > 0) {
    const list = status.drifted.map((d) => `${d.version}_${d.name}`).join(', ');
    throw new MigrationError(`refusing to migrate: applied migration(s) were edited after being applied: ${list}. Write a new migration instead.`);
  }
  const applied: string[] = [];
  for (const migration of status.pending) {
    const client = await pool.connect();
    const noticeHandler = (notice: { message?: string }): void => {
      // Intent: surface SQL-level RAISE WARNING messages (notably a missing optional readonly role) in the migration log.
      // Flow:   PostgreSQL emits a notice while the migration query runs -> forward its message -> continue the migration.
      log.warn(`migration ${migration.version}_${migration.name}: ${notice.message ?? 'database notice'}`);
    };
    // Intent: keep the runner compatible with minimal test doubles while using pg's notice stream in production.
    // Flow:   detect EventEmitter support -> attach forwarding when available -> run the same transaction either way.
    const supportsNotices = typeof client.on === 'function' && typeof client.off === 'function';
    if (supportsNotices) client.on('notice', noticeHandler);
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        migration.version,
        migration.name,
        migration.checksum,
      ]);
      await client.query('COMMIT');
      applied.push(`${migration.version}_${migration.name}`);
      log.info(`applied ${migration.version}_${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new MigrationError(
        `migration ${migration.version}_${migration.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (supportsNotices) client.off('notice', noticeHandler);
      client.release();
    }
  }
  if (applied.length === 0) log.info('0 pending migrations');
  return { applied };
}

export async function migrateDown(pool: pg.Pool, dir: string, log: MigrationLogger): Promise<{ reverted: string | null }> {
  const status = await migrationStatus(pool, dir);
  const latest = status.applied.at(-1);
  if (!latest) {
    log.info('nothing to revert');
    return { reverted: null };
  }
  const file = listMigrations(dir).find((f) => f.version === latest.version);
  const downPath = file ? downFileFor(file) : null;
  if (!file || !downPath) {
    throw new MigrationError(`no down file for ${latest.version}_${latest.name} (expected ${basename(latest.version)}_${latest.name}.down.sql)`);
  }
  const client = await pool.connect();
  const noticeHandler = (notice: { message?: string }): void => {
    // Intent: keep rollback warnings observable when a down migration handles an optional role gracefully.
    // Flow:   PostgreSQL emits a notice -> migration logger records it -> rollback continues normally.
    log.warn(`migration ${latest.version}_${latest.name}: ${notice.message ?? 'database notice'}`);
  };
  // Intent: preserve the same optional notice behavior for down migrations and lightweight test clients.
  // Flow:   attach only when the client exposes EventEmitter methods -> execute rollback -> detach before release.
  const supportsNotices = typeof client.on === 'function' && typeof client.off === 'function';
  if (supportsNotices) client.on('notice', noticeHandler);
  try {
    await client.query('BEGIN');
    await client.query(readFileSync(downPath, 'utf8'));
    await client.query('DELETE FROM schema_migrations WHERE version = $1', [latest.version]);
    await client.query('COMMIT');
    log.info(`reverted ${latest.version}_${latest.name}`);
    return { reverted: `${latest.version}_${latest.name}` };
  } catch (error) {
    await client.query('ROLLBACK');
    throw new MigrationError(`down migration ${latest.version}_${latest.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (supportsNotices) client.off('notice', noticeHandler);
    client.release();
  }
}
