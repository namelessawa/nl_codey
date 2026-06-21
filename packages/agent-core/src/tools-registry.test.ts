import { describe, expect, it } from "vitest";
import type { FileSnapshot, LLMToolCall } from "@nlc/shared";
import {
  AGENT_TOOL_SCHEMAS,
  FILE_MUTATING_TOOLS,
  agentToolSchemas,
  createToolExecutor,
} from "./tools-registry.js";

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

describe("agentToolSchemas read-only mode", () => {
  it("returns the full schema list when not read-only", () => {
    expect(agentToolSchemas()).toEqual(AGENT_TOOL_SCHEMAS);
    expect(agentToolSchemas({ readOnly: false })).toEqual(AGENT_TOOL_SCHEMAS);
  });

  it("strips every file-mutating tool when read-only", () => {
    const names = agentToolSchemas({ readOnly: true }).map((t) => t.name);
    for (const mutating of FILE_MUTATING_TOOLS) {
      expect(names).not.toContain(mutating);
    }
    // apply_patch is the mutating tool actually present in the base list.
    expect(names).not.toContain("apply_patch");
    // Read-only tools are untouched.
    expect(names).toContain("read_file");
    expect(names).toContain("search_text");
    expect(names).toContain("find_symbol");
  });
});

describe("createToolExecutor read-only guard", () => {
  function readOnlyExecutor() {
    return createToolExecutor({
      ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
      storage: noopStorage,
      allowShellExecution: true,
      readOnly: true,
    });
  }

  it("refuses apply_patch before writing any snapshot", async () => {
    const res = await readOnlyExecutor()(
      call("apply_patch", { patch: "*** Begin Patch\n*** End Patch" }),
    );
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("read-only");
    // The guard fires before the apply_patch branch — no patch metadata leaks.
    expect(res.patch).toBeUndefined();
    expect(res.changedFiles).toBeUndefined();
  });

  it("still allows read-only tools through", async () => {
    const res = await readOnlyExecutor()(
      call("read_file_range", { path: "package.json", startLine: 1, endLine: 5 }),
    );
    expect(res.isError).toBe(false);
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

describe("createToolExecutor assertToolAllowed gate", () => {
  // The installation gate is consulted BEFORE the dispatcher's switch. A
  // throwing gate must produce a structured error result rather than
  // crashing the executor — that's the loop's contract.
  function withGate(blockedTools: Set<string>) {
    return createToolExecutor({
      ctx: { workspaceRoot: process.cwd(), runId: "test-run" },
      storage: noopStorage,
      allowShellExecution: true,
      assertToolAllowed: (toolName: string) => {
        if (blockedTools.has(toolName)) {
          throw new Error(`Tool "${toolName}" is disabled in degraded mode`);
        }
      },
    });
  }

  it("blocks run_command before the dispatcher runs the host command", async () => {
    const exec = withGate(new Set(["run_command"]));
    const res = await exec(call("run_command", { command: "pnpm test" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("degraded mode");
    // The gate fires before the run_command branch, so no command output
    // should be attached to the result.
    expect(res.command).toBeUndefined();
  });

  it("blocks apply_patch before the dispatcher writes any snapshot", async () => {
    const exec = withGate(new Set(["apply_patch"]));
    const res = await exec(call("apply_patch", { patch: "*** Begin Patch\n*** End Patch" }));
    expect(res.isError).toBe(true);
    expect(res.resultText).toContain("degraded mode");
    expect(res.patch).toBeUndefined();
    expect(res.changedFiles).toBeUndefined();
  });

  it("lets safe read-only tools through when the gate allows them", async () => {
    // Only block unsafe tools; read_file_range should still work normally.
    const exec = withGate(new Set(["run_command", "apply_patch"]));
    const res = await exec(
      call("read_file_range", { path: "package.json", startLine: 1, endLine: 5 }),
    );
    expect(res.isError).toBe(false);
  });
});
