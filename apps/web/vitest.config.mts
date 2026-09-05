import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Pure-logic tests only (formatting, SSE helpers, field maths, prism geometry); the pages are verified in Chrome.
 * The `@/` alias mirrors `tsconfig.json` so a test can import a module that imports a component by alias.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
