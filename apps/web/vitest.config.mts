import { defineConfig } from "vitest/config";

/** Pure-logic tests only (formatting, SSE helpers, prism geometry); the pages are verified in Chrome. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
