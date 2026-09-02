import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/desktop/src/main/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
