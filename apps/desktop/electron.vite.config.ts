import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages ship TypeScript source, so they must be bundled (not
// externalized). Native / binary deps stay external.
const workspacePackages = [
  "@nlc/shared",
  "@nlc/sandbox",
  "@nlc/storage",
  "@nlc/llm",
  "@nlc/tools",
  "@nlc/project-indexer",
  "@nlc/agent-core",
  "@nlc/semantic-index",
  "@nlc/memory",
  "@nlc/planner",
  "@nlc/orchestrator",
  "@nlc/git-integration",
  "@nlc/web-tools",
  "@nlc/global-memory",
  "@nlc/style-profile",
  "@nlc/learning",
  "@nlc/finetune",
  "@nlc/distributed",
  "@nlc/proactive",
  "@nlc/plugin-sdk",
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
