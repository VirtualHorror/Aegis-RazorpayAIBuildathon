import { fileURLToPath } from 'node:url';

/** Repo-root relative locations, resolved from this file so they work from any cwd (tsx, vitest, pnpm --filter). */
export const REPO_ROOT_ENV = fileURLToPath(new URL('../../../../.env', import.meta.url));
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../db/migrations', import.meta.url));
