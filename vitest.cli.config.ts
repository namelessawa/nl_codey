import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/cli/src/tui/commands.test.ts",
      "apps/cli/src/lib/host-protocol.test.ts",
      "apps/cli/src/commands/diagnostics.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
    testNamePattern: /^\[cli\]/,
  },
});
