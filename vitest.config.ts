import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup-env.ts"],
    // Tenant-isolation tests share seeded rows; keep file-level parallelism off.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
