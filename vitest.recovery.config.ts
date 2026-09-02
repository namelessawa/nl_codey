import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/core/storage/src/storage.test.ts",
      "packages/runtime/agent-core/src/rollback.recovery.integration.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    passWithNoTests: false,
  },
});
