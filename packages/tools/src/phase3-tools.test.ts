import { describe, expect, it } from "vitest";
import type {
  ReadMemoryHit,
  SemanticSearchToolHit,
  ToolContext,
  UpdateTaskStatusInput,
  WriteMemoryInput,
} from "@coding-agent/shared";
import { createSemanticSearchTool } from "./semantic-search-tool.js";
import { createUpdateTaskStatusTool } from "./task-tools.js";
import { createReadMemoryTool, createWriteMemoryTool } from "./memory-tools.js";
import { ToolError } from "./errors.js";
import type { MemoryPort, SemanticSearchPort, TaskPort } from "./phase3-deps.js";

const ctx: ToolContext = { workspaceRoot: "/ws", runId: "run-1" };

describe("createSemanticSearchTool", () => {
  it("maps port hits into the output shape", async () => {
    const hit: SemanticSearchToolHit = {
      filePath: "src/a.ts",
      startLine: 10,
      endLine: 20,
      snippet: "function foo() {}",
      score: 0.9,
      symbolName: "foo",
    };
    const port: SemanticSearchPort = {
      async search() {
        return [hit];
      },
    };
    const tool = createSemanticSearchTool(port);

    const out = await tool.run({ query: "how does foo work" }, ctx);

    expect(out.query).toBe("how does foo work");
    expect(out.hits).toEqual([hit]);
  });

  it("forwards topK and kinds options to the port", async () => {
    let received: { topK?: number; kinds?: ("code" | "doc" | "comment")[] } | undefined;
    const port: SemanticSearchPort = {
      async search(_query, opts) {
        received = opts;
        return [];
      },
    };
    const tool = createSemanticSearchTool(port);

    await tool.run({ query: "q", topK: 3, kinds: ["doc"] }, ctx);

    expect(received).toEqual({ topK: 3, kinds: ["doc"] });
  });
});

describe("createUpdateTaskStatusTool", () => {
  it("passes the status update through to the port", async () => {
    let received: UpdateTaskStatusInput | undefined;
    const port: TaskPort = {
      async proposeBreakdown() {
        return { accepted: true, taskCount: 0, issues: [] };
      },
      async updateStatus(input) {
        received = input;
        return { taskNodeId: input.taskNodeId, status: input.status };
      },
    };
    const tool = createUpdateTaskStatusTool(port);

    const out = await tool.run(
      { taskNodeId: "t1", status: "succeeded", note: "done" },
      ctx,
    );

    expect(received).toEqual({ taskNodeId: "t1", status: "succeeded", note: "done" });
    expect(out).toEqual({ taskNodeId: "t1", status: "succeeded" });
  });
});

describe("createReadMemoryTool", () => {
  it("applies a default entry cap and returns hits", async () => {
    const hit: ReadMemoryHit = {
      id: "m1",
      kind: "fact",
      title: "t",
      body: "b",
      tags: [],
      score: 1,
    };
    let receivedMax: number | undefined;
    const port: MemoryPort = {
      async read(_q, _k, max) {
        receivedMax = max;
        return [hit];
      },
      async write() {
        return { id: "x", kind: "fact" };
      },
    };
    const tool = createReadMemoryTool(port);

    const out = await tool.run({ query: "anything" }, ctx);

    expect(receivedMax).toBe(10);
    expect(out.hits).toEqual([hit]);
  });
});

describe("createWriteMemoryTool", () => {
  function memoryPort(): MemoryPort {
    return {
      async read() {
        return [];
      },
      async write(input) {
        return { id: "m1", kind: input.kind };
      },
    };
  }

  it("accepts kind 'fact' and 'decision'", async () => {
    const tool = createWriteMemoryTool(memoryPort());

    const fact = await tool.run({ kind: "fact", title: "t", body: "b" }, ctx);
    const decision = await tool.run({ kind: "decision", title: "t", body: "b" }, ctx);

    expect(fact).toEqual({ id: "m1", kind: "fact" });
    expect(decision).toEqual({ id: "m1", kind: "decision" });
  });

  it("rejects kind 'failure'", async () => {
    const tool = createWriteMemoryTool(memoryPort());
    const input = { kind: "failure", title: "t", body: "b" } as unknown as WriteMemoryInput;

    await expect(tool.run(input, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it("rejects kind 'preference'", async () => {
    const tool = createWriteMemoryTool(memoryPort());
    const input = { kind: "preference", title: "t", body: "b" } as unknown as WriteMemoryInput;

    await expect(tool.run(input, ctx)).rejects.toThrow(/fact.*decision/);
  });
});
