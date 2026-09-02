import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/core/storage/src/storage.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
