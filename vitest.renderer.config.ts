import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/desktop/src/test/surface-smoke.test.ts"],
    testNamePattern: /^\[renderer\]/,
    environment: "node",
    passWithNoTests: false,
  },
});
