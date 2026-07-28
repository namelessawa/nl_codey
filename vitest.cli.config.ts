import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/commands.test.ts"],
    environment: "node",
    passWithNoTests: false,
    testNamePattern: /^\[cli\]/,
  },
});
