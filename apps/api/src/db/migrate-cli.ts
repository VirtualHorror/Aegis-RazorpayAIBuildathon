import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../config';
import { MigrationError, migrateDown, migrateUp, migrationStatus } from './migrate';
import { MIGRATIONS_DIR, REPO_ROOT_ENV } from './paths';
import { createPools } from './pool';

/**
 * CLI: `tsx src/db/migrate-cli.ts up|down|status`. Reads .env from the repo root.
 * Flow: dotenv → config → pool → command → exit code (0 ok, 1 failure, 2 usage).
 * Guarded so importing this module never runs the CLI (a 2 AM lesson from Task 1, see Bug-Feature.md B-001).
 */

async function main(): Promise<number> {
  loadDotenv({ path: REPO_ROOT_ENV, quiet: true });
  const command = process.argv[2];
  if (!command || !['up', 'down', 'status'].includes(command)) {
    console.error('usage: migrate-cli <up|down|status>');
    return 2;
  }
  const config = loadConfig();
  const pools = createPools(config);
  const log = { info: (m: string) => console.log(m), warn: (m: string) => console.warn(m) };
  try {
    if (command === 'up') {
      const { applied } = await migrateUp(pools.rw, MIGRATIONS_DIR, log);
      console.log(`applied ${applied.length} migration(s)`);
    } else if (command === 'down') {
      const { reverted } = await migrateDown(pools.rw, MIGRATIONS_DIR, log);
      console.log(reverted ? `reverted ${reverted}` : 'nothing reverted');
    } else {
      const status = await migrationStatus(pools.rw, MIGRATIONS_DIR);
      console.log(`applied: ${status.applied.map((m) => `${m.version}_${m.name}`).join(', ') || '(none)'}`);
      console.log(`pending: ${status.pending.map((m) => `${m.version}_${m.name}`).join(', ') || '(none)'}`);
      if (status.drifted.length) console.warn(`DRIFTED: ${status.drifted.map((d) => `${d.version}_${d.name}`).join(', ')}`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof MigrationError ? error.message : error);
    return 1;
  } finally {
    await pools.end();
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => process.exit(code));
}
