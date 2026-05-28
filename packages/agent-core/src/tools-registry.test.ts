import { describe, expect, it } from "vitest";
import type { FileSnapshot, LLMToolCall } from "@coding-agent/shared";
import { AGENT_TOOL_SCHEMAS, createToolExecutor } from "./tools-registry.js";

const noopStorage = {
  addSnapshot(): FileSnapshot {
    return { id: "x", runId: "r", filePath: "f", beforeContent: "", createdAt: 0 };
  },
  setSnapshotAfter(): void {},
};

function executor(allowShellExecution: boolean) {
  return createToolExecutor({
    ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
    storage: noopStorage,
    allowShellExecution,
  });
}

function call(name: string, args: unknown): LLMToolCall {
  return { id: "c1", name, args };
}

describe("AGENT_TOOL_SCHEMAS", () => {
  it("exposes the core tool names", () => {
    expect(AGENT_TOOL_SCHEMAS.map((t) => t.name)).toEqual([
      "list_files",
      "read_file",
      "search_text",
      "apply_patch",
      "run_command",
      "read_file_range",
      "find_symbol",
      "git_status",
      "git_diff",
      "record_plan",
    ]);
  });
});

describe("createToolExecutor guards", () => {
  it("returns an error for an unknown tool without throwing", async () => {
    const res = await executor(true)(call("nope", {}));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("Unknown tool");
  });

  it("requires the path argument for read_file", async () => {
    const res = await executor(true)(call("read_file", {}));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("path");
  });

  it("refuses run_command when shell execution is disabled", async () => {
    const res = await executor(false)(call("run_command", { command: "pnpm test" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("disabled");
  });

  it("runs find_symbol and returns a symbols payload", async () => {
    const res = await executor(true)(call("find_symbol", { path: "src/symbols.ts", name: "extractSymbols" }));
    expect(res.isError).toBe(false);
    const parsed = JSON.parse(res.resultText) as { symbols: Array<{ name: string }> };
    expect(Array.isArray(parsed.symbols)).toBe(true);
  });
});
