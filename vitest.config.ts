import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Suites share one hosted Postgres database; run files sequentially to
    // avoid cross-tenant interference. Seeds do network round trips, so the
    // per-test budget is generous.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
