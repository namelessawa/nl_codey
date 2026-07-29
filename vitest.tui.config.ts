import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/cli/src/tui/commands.test.ts",
      "apps/cli/src/tui/prompt-editor.test.ts",
      "apps/cli/src/tui/stream-bounds.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
    testNamePattern: /^\[tui\]/,
  },
});
