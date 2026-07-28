import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/runtime/agent-core/src/real-llm.integration.test.ts",
    ],
    environment: "node",
    env: {
      NLC_RUN_LIVE_LLM_SMOKE: "1",
    },
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 10_000,
    passWithNoTests: false,
  },
});
