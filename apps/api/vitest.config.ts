import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Keep node-postgres bigint values aligned with production before any integration pool is created.
    setupFiles: ['./src/db/pg-types.ts'],
    // Integration tests (test/**) talk to DATABASE_URL_TEST; keep them serial so table truncation cannot interleave.
    fileParallelism: false,
    // Vitest can still create one pool worker per file when invoked from pnpm; one worker makes the shared database
    // isolation explicit for the projection/worker integration files as well as their direct `beforeEach` truncations.
    minWorkers: 1,
    maxWorkers: 1,
  },
});
