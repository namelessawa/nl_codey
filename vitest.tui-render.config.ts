import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/cli/src/tui/**/*.render.test.tsx"],
    testNamePattern: /^\[tui-render\]/,
    environment: "node",
    env: {
      FORCE_COLOR: "1",
    },
    passWithNoTests: false,
  },
});
