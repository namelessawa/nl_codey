import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/crash-cleanup.soak.pty.test.ts"],
    testNamePattern: /^\[tui-crash-soak\]/,
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 45_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
