import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/core/sandbox/src/runchild-abort.test.ts",
      "packages/runtime/tools/src/e2e-docker.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
    testTimeout: 60_000,
  },
});
