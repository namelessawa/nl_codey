import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/**/*.test.ts", "apps/cli/src/tui/**/*.test.tsx"],
    environment: "node",
    passWithNoTests: false,
    testNamePattern: /^\[tui\]/,
  },
});
