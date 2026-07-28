import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/**/*.e2e.pty.test.ts"],
    testNamePattern: /^\[tui-e2e\]/,
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 15_000,
    passWithNoTests: false,
  },
});
