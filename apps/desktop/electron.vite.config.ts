import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages ship TypeScript source, so they must be bundled (not
// externalized). Native / binary deps stay external.
const workspacePackages = [
  "@coding-agent/shared",
  "@coding-agent/sandbox",
  "@coding-agent/storage",
  "@coding-agent/llm",
  "@coding-agent/tools",
  "@coding-agent/project-indexer",
  "@coding-agent/agent-core",
  "@coding-agent/semantic-index",
  "@coding-agent/memory",
  "@coding-agent/planner",
  "@coding-agent/orchestrator",
  "@coding-agent/git-integration",
  "@coding-agent/web-tools",
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
