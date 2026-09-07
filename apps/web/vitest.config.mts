import { fileURLToPath } from "node:url";
import wgslVitePlugin from "@vgpu/wgsl/loader-vite";
import { defineConfig } from "vitest/config";

/**
 * Pure-logic tests only (formatting, SSE helpers, field maths, prism optics and mesh generation); the
 * pages are verified in Chrome.
 *
 * `wgslVitePlugin` is vgpu's own `.wgsl` loader — the Vite counterpart of the `loader-webpack` rule
 * `next.config.ts` gives Turbopack. Without it `gpu/pipeline.ts` cannot be imported at all, so the
 * prism pipeline test would have nothing to build (D-087). The `@/` alias mirrors `tsconfig.json`.
 */
export default defineConfig({
  plugins: [wgslVitePlugin()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
