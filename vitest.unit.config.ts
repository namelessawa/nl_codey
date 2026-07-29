import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/*.debug.test.ts",
      "**/*.integration.test.ts",
      "**/eval/benchmark.recorded.test.ts",
      "**/e2e-*.test.ts",
      "packages/core/storage/src/storage.test.ts",
      "packages/core/sandbox/src/runchild-abort.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
