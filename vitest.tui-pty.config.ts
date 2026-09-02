import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/**/*.pty.test.ts"],
    testNamePattern: /^\[tui-pty\]/,
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 10_000,
    passWithNoTests: false,
  },
});
