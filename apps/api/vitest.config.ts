import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests (test/**) talk to DATABASE_URL_TEST; keep them serial so table truncation cannot interleave.
    fileParallelism: false,
  },
});
