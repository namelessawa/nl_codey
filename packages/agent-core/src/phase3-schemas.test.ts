import { describe, expect, it } from "vitest";
import type {
  LLMToolCall,
  ReadMemoryHit,
  SemanticSearchToolHit,
  ToolContext,
  WebFetchToolInput,
  WebSearchToolInput,
  WriteMemoryInput,
} from "@coding-agent/shared";
import {
  PHASE3_AGENT_TOOL_NAMES,
  PHASE3_AGENT_TOOL_SCHEMAS,
  PHASE3_MUTATING_TOOLS,
  createPhase3Dispatcher,
  type Phase3AgentPorts,
} from "./phase3-schemas.js";
import {
  AGENT_TOOL_SCHEMAS,
  agentToolSchemas,
  FILE_MUTATING_TOOLS,
} from "./tools-registry.js";

const CTX: ToolContext = { workspaceRoot: "/tmp/ws", runId: "run-1" };

function makeCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return { id: "c-1", name, args };
}

/**
 * In-memory test double for the Phase 3 ports. Captures the inputs the
 * dispatcher passes through and lets each test script the response.
 */
function makePorts(): {
  ports: Phase3AgentPorts;
  semanticCalls: { query: string; opts?: unknown }[];
  memoryReads: { query?: string; kind?: string; max: number }[];
  memoryWrites: WriteMemoryInput[];
  webSearches: WebSearchToolInput[];
  webFetches: WebFetchToolInput[];
} {
  const semanticCalls: { query: string; opts?: unknown }[] = [];
  const memoryReads: { query?: string; kind?: string; max: number }[] = [];
  const memoryWrites: WriteMemoryInput[] = [];
  const webSearches: WebSearchToolInput[] = [];
  const webFetches: WebFetchToolInput[] = [];

  const ports: Phase3AgentPorts = {
    semanticSearch: {
      async search(query, opts) {
        semanticCalls.push({ query, opts });
        const hit: SemanticSearchToolHit = {
          filePath: "src/foo.ts",
          startLine: 1,
          endLine: 10,
          snippet: "fn foo()",
          score: 0.9,
        };
        return [hit];
      },
    },
    memory: {
      async read(query, kind, max) {
        const entry: { query?: string; kind?: string; max: number } = { max };
        if (query !== undefined) entry.query = query;
        if (kind !== undefined) entry.kind = kind;
        memoryReads.push(entry);
        const hit: ReadMemoryHit = {
          id: "m1",
          kind: "decision",
          title: "use vitest",
          body: "...",
          tags: [],
          score: 1,
        };
        return [hit];
      },
      async write(input) {
        memoryWrites.push(input);
        return { id: "m-new", kind: input.kind };
      },
    },
    web: {
      async search(input) {
        webSearches.push(input);
        return { query: input.query, results: [] };
      },
      async fetch(input) {
        webFetches.push(input);
        return { url: input.url, text: "stub", truncated: false };
      },
    },
  };
  return { ports, semanticCalls, memoryReads, memoryWrites, webSearches, webFetches };
}

describe("PHASE3_AGENT_TOOL_SCHEMAS", () => {
  it("declares all five single-agent Phase 3 tools by name", () => {
    const names = PHASE3_AGENT_TOOL_SCHEMAS.map((s) => s.name).sort();
    expect(names).toEqual(
      [...PHASE3_AGENT_TOOL_NAMES].sort(),
    );
  });

  it("marks write_memory as a mutating tool", () => {
    expect(PHASE3_MUTATING_TOOLS).toContain("write_memory");
    expect(PHASE3_MUTATING_TOOLS).not.toContain("read_memory");
  });
});

describe("agentToolSchemas integration with Phase 3", () => {
  it("does not advertise Phase 3 tools when phase3Available is false", () => {
    const schemas = agentToolSchemas({ phase3Available: false });
    expect(schemas.map((s) => s.name)).toEqual(AGENT_TOOL_SCHEMAS.map((s) => s.name));
  });

  it("advertises all Phase 3 tools when phase3Available is true", () => {
    const schemas = agentToolSchemas({ phase3Available: true });
    for (const name of PHASE3_AGENT_TOOL_NAMES) {
      expect(schemas.find((s) => s.name === name)).toBeDefined();
    }
  });

  it("strips write_memory in read-only mode but keeps read-only Phase 3 tools", () => {
    const schemas = agentToolSchemas({ phase3Available: true, readOnly: true });
    const names = schemas.map((s) => s.name);
    // Mutating tools stripped
    expect(names).not.toContain("write_memory");
    expect(names).not.toContain("apply_patch");
    expect(names).not.toContain("write_file");
    // Read-only Phase 3 tools survive
    expect(names).toContain("semantic_search");
    expect(names).toContain("read_memory");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  it("file mutating tools list is a subset of read-only stripping", () => {
    const readonlySchemas = agentToolSchemas({ phase3Available: true, readOnly: true });
    const names = readonlySchemas.map((s) => s.name);
    for (const mutating of FILE_MUTATING_TOOLS) {
      expect(names).not.toContain(mutating);
    }
  });
});

describe("createPhase3Dispatcher", () => {
  it("returns null for unknown tool names so the caller can fall through", async () => {
    const { ports } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    const result = await dispatch(makeCall("read_file", { path: "x" }), CTX);
    expect(result).toBeNull();
  });

  it("routes semantic_search to the semantic port and serialises hits", async () => {
    const { ports, semanticCalls } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    const result = await dispatch(
      makeCall("semantic_search", { query: "auth flow", topK: 3 }),
      CTX,
    );
    expect(result?.isError).toBe(false);
    expect(result?.name).toBe("semantic_search");
    const payload = JSON.parse(result!.resultText) as {
      query: string;
      hits: SemanticSearchToolHit[];
    };
    expect(payload.query).toBe("auth flow");
    expect(payload.hits[0]?.filePath).toBe("src/foo.ts");
    expect(semanticCalls[0]?.query).toBe("auth flow");
    expect((semanticCalls[0]?.opts as { topK?: number })?.topK).toBe(3);
  });

  it("rejects semantic_search with no query", async () => {
    const { ports } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    const result = await dispatch(makeCall("semantic_search", {}), CTX);
    expect(result?.isError).toBe(true);
    expect(JSON.parse(result!.resultText).error).toContain("query");
  });

  it("routes read_memory and forwards optional filters", async () => {
    const { ports, memoryReads } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    const result = await dispatch(
      makeCall("read_memory", { query: "logger", kind: "decision", maxEntries: 5 }),
      CTX,
    );
    expect(result?.isError).toBe(false);
    expect(memoryReads[0]).toEqual({ query: "logger", kind: "decision", max: 5 });
  });

  it("defaults read_memory max to 10 when not provided", async () => {
    const { ports, memoryReads } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    await dispatch(makeCall("read_memory", {}), CTX);
    expect(memoryReads[0]?.max).toBe(10);
  });

  it("routes write_memory and rejects disallowed kinds", async () => {
    const { ports, memoryWrites } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    const ok = await dispatch(
      makeCall("write_memory", {
        kind: "decision",
        title: "use vitest",
        body: "vitest is the workspace runner",
      }),
      CTX,
    );
    expect(ok?.isError).toBe(false);
    expect(memoryWrites[0]?.kind).toBe("decision");

    const bad = await dispatch(
      makeCall("write_memory", {
        kind: "preference",
        title: "x",
        body: "y",
      }),
      CTX,
    );
    expect(bad?.isError).toBe(true);
    expect(JSON.parse(bad!.resultText).error).toContain('"fact" or "decision"');
  });

  it("routes web_search and web_fetch through the web port", async () => {
    const { ports, webSearches, webFetches } = makePorts();
    const dispatch = createPhase3Dispatcher(ports);
    await dispatch(makeCall("web_search", { query: "vitest mocks" }), CTX);
    await dispatch(makeCall("web_fetch", { url: "https://example.com" }), CTX);
    expect(webSearches[0]?.query).toBe("vitest mocks");
    expect(webFetches[0]?.url).toBe("https://example.com");
  });

  it("wraps a thrown port error into a structured tool result", async () => {
    const ports: Phase3AgentPorts = {
      semanticSearch: {
        async search() {
          throw new Error("embedder offline");
        },
      },
      memory: {
        async read() {
          return [];
        },
        async write() {
          return { id: "x", kind: "fact" };
        },
      },
      web: {
        async search() {
          return { query: "", results: [] };
        },
        async fetch() {
          return { url: "", text: "", truncated: false };
        },
      },
    };
    const dispatch = createPhase3Dispatcher(ports);
    const result = await dispatch(
      makeCall("semantic_search", { query: "x" }),
      CTX,
    );
    expect(result?.isError).toBe(true);
    expect(JSON.parse(result!.resultText).error).toContain("embedder offline");
  });
});
