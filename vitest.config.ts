import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      // Main-process tests for apps/desktop. Renderer/React component
      // tests are NOT picked up here — they would need a jsdom env and
      // a separate config; current desktop tests are pure node code.
      "apps/desktop/src/main/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
