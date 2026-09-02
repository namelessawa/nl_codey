import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/runtime/agent-core/src/eval/benchmark.live.integration.test.ts",
    ],
    environment: "node",
    env: {
      NLC_RUN_LIVE_BENCHMARK: "1",
    },
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 1_800_000,
    hookTimeout: 10_000,
    passWithNoTests: false,
  },
});
