import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/runtime/agent-core/src/eval/benchmark.recorded.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 10_000,
    passWithNoTests: false,
  },
});
