/**
 * Verifies the three-phase contract of the NLC loop end-to-end.
 *
 * Phase 1: composeSystemMessage stacks built-in + global + project +
 *          agents + skills in that order, project wins on name collision.
 * Phase 2: passes through when below threshold, compresses when above.
 * Phase 3: ReAct until no tool calls, returns final text; abort signal
 *          interrupts mid-loop; injected invoke_skill returns skill body
 *          and never reaches the caller's executeTool.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ChatLLMProvider,
  LLMChunk,
  LLMMessage,
  LLMToolCall,
  ToolSchema,
} from "@nlc/shared";
import { composeSystemMessage, parseFrontmatter, phase1InitContext } from "./index.js";
import { phase2Transform } from "./transform.js";
import { phase3ReactLoop } from "./react.js";
import { runNlcLoop } from "./index.js";
import type {
  ContextInputs,
  NlcLoopDeps,
  NlcLoopInput,
  Phase1Result,
  Phase2Result,
} from "./types.js";

// --- helpers -----------------------------------------------------------

function tempDir(prefix = "nlc-loop-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir: string, name: string, content: string): string {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

/**
 * Scripted streaming provider — each call to chat() returns the next
 * pre-canned turn. Lets the test drive the ReAct loop deterministically
 * without any HTTP / SDK calls.
 */
type ScriptedTurn = {
  text?: string;
  toolCalls?: LLMToolCall[];
  finishReason?: "stop" | "tool_use" | "max_tokens" | "error";
  errorMessage?: string;
};

function scriptedProvider(model: string, script: ScriptedTurn[]): ChatLLMProvider {
  let cursor = 0;
  return {
    name: "scripted",
    model,
    contextWindow: 100_000,
    chat: ({ messages, tools, signal }) => {
      const turn = script[cursor++] ?? { text: "(out of script)", finishReason: "stop" };
      void messages;
      void tools;
      void signal;
      return (async function* (): AsyncGenerator<LLMChunk> {
        if (turn.text) yield { type: "text_delta", text: turn.text };
        for (const tc of turn.toolCalls ?? []) {
          yield { type: "tool_call", id: tc.id, name: tc.name, args: tc.args };
        }
        if (turn.finishReason === "error") {
          yield {
            type: "error",
            message: turn.errorMessage ?? "scripted error",
          };
          return;
        }
        yield {
          type: "finish",
          reason: turn.finishReason ?? "stop",
          usage: { inputTokens: 5, outputTokens: 5, costUsd: 0 },
        };
      })();
    },
    complete: async ({ messages }) => {
      // Used only by Phase 2's summariser. Echo a short fixed summary so
      // tests don't fight a real model output.
      void messages;
      return { text: "summary", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
    },
  };
}

const TOOLS: ToolSchema[] = [
  {
    name: "echo",
    description: "Echo back the input string verbatim.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

// --- Phase 1 ----------------------------------------------------------

describe("Phase 1 — initContext", () => {
  it("stacks built-in + global + project + agents + skills in order", async () => {
    const globalRoot = tempDir("nlc-global-");
    const workspace = tempDir("nlc-ws-");
    writeFile(globalRoot, "system.md", "GLOBAL_SYS");
    writeFile(workspace, ".nlc/system.md", "PROJECT_SYS");
    writeFile(globalRoot, "agents.md", "GLOBAL_AGENTS");
    writeFile(workspace, "AGENTS.md", "PROJECT_AGENTS");
    writeFile(
      globalRoot,
      "skills/sk1.md",
      "---\nname: sk1\ndescription: first skill\n---\nbody-sk1",
    );
    writeFile(
      workspace,
      ".nlc/skills/sk2.md",
      "---\nname: sk2\ndescription: second skill\nwhen_to_use: never\n---\nbody-sk2",
    );

    const deps: NlcLoopDeps = {
      llm: scriptedProvider("test", []),
      tools: TOOLS,
      executeTool: vi.fn(),
      options: { globalRoot, language: "en-US" },
    };
    const result = await phase1InitContext(
      { currentMessage: "hi", workspaceRoot: workspace },
      deps,
    );

    expect(result.inputs.globalSystem).toBe("GLOBAL_SYS");
    expect(result.inputs.projectSystem).toBe("PROJECT_SYS");
    expect(result.inputs.globalAgents).toBe("GLOBAL_AGENTS");
    expect(result.inputs.projectAgents).toBe("PROJECT_AGENTS");
    expect(result.inputs.skills.map((s) => s.name)).toEqual(["sk1", "sk2"]);

    const sys = result.messages[0]!.content as string;
    const idxBuiltin = sys.indexOf(result.inputs.builtin.slice(0, 40));
    const idxGlobalSys = sys.indexOf("GLOBAL_SYS");
    const idxProjectSys = sys.indexOf("PROJECT_SYS");
    const idxGlobalAgents = sys.indexOf("GLOBAL_AGENTS");
    const idxProjectAgents = sys.indexOf("PROJECT_AGENTS");
    const idxSkills = sys.indexOf("Available skills");
    expect(idxBuiltin).toBeGreaterThanOrEqual(0);
    expect(idxGlobalSys).toBeGreaterThan(idxBuiltin);
    expect(idxProjectSys).toBeGreaterThan(idxGlobalSys);
    expect(idxGlobalAgents).toBeGreaterThan(idxProjectSys);
    expect(idxProjectAgents).toBeGreaterThan(idxGlobalAgents);
    expect(idxSkills).toBeGreaterThan(idxProjectAgents);

    // History stale system is dropped; current user message goes last.
    expect(result.messages.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  it("project skill replaces a global skill with the same name", async () => {
    const globalRoot = tempDir("nlc-global-");
    const workspace = tempDir("nlc-ws-");
    writeFile(
      globalRoot,
      "skills/shared.md",
      "---\nname: shared\ndescription: GLOBAL VERSION\n---\nglobal-body",
    );
    writeFile(
      workspace,
      ".nlc/skills/shared.md",
      "---\nname: shared\ndescription: PROJECT VERSION\n---\nproject-body",
    );

    const deps: NlcLoopDeps = {
      llm: scriptedProvider("test", []),
      tools: TOOLS,
      executeTool: vi.fn(),
      options: { globalRoot },
    };
    const result = await phase1InitContext(
      { currentMessage: "hi", workspaceRoot: workspace },
      deps,
    );

    expect(result.inputs.skills).toHaveLength(1);
    expect(result.inputs.skills[0]!.description).toBe("PROJECT VERSION");
    expect(result.inputs.skills[0]!.body).toBe("project-body");
    expect(result.inputs.skills[0]!.source).toBe("project");
  });

  it("drops stale system messages from history and re-derives", async () => {
    const globalRoot = tempDir("nlc-global-");
    const workspace = tempDir("nlc-ws-");
    const history: LLMMessage[] = [
      { role: "system", content: "OLD STALE SYSTEM" },
      { role: "user", content: "earlier task" },
      { role: "assistant", content: "earlier answer" },
    ];
    const deps: NlcLoopDeps = {
      llm: scriptedProvider("test", []),
      tools: TOOLS,
      executeTool: vi.fn(),
      options: { globalRoot },
    };
    const result = await phase1InitContext(
      { currentMessage: "new", workspaceRoot: workspace, history },
      deps,
    );
    const systemContent = result.messages[0]!.content as string;
    expect(systemContent.includes("OLD STALE SYSTEM")).toBe(false);
    expect(result.messages.some((m) => m.role === "user" && m.content === "earlier task")).toBe(
      true,
    );
  });
});

describe("parseFrontmatter", () => {
  it("returns empty frontmatter when no fence is present", () => {
    expect(parseFrontmatter("hello world")).toEqual({
      frontmatter: {},
      body: "hello world",
    });
  });
  it("parses simple key: value pairs", () => {
    const r = parseFrontmatter("---\nname: foo\ndescription: bar baz\n---\nbody");
    expect(r.frontmatter).toEqual({ name: "foo", description: "bar baz" });
    expect(r.body).toBe("body");
  });
  it("strips surrounding quotes from values", () => {
    const r = parseFrontmatter('---\nname: "quoted"\n---\nb');
    expect(r.frontmatter.name).toBe("quoted");
  });
});

// --- Phase 2 ----------------------------------------------------------

function phase1FromMessages(messages: LLMMessage[]): Phase1Result {
  const inputs: ContextInputs = {
    builtin: "builtin",
    globalSystem: null,
    projectSystem: null,
    globalAgents: null,
    projectAgents: null,
    skills: [],
    augmentation: "",
  };
  return { messages, inputs };
}

describe("Phase 2 — transform", () => {
  it("passes through when token estimate is below the threshold", async () => {
    const messages: LLMMessage[] = [
      { role: "system", content: "small system" },
      { role: "user", content: "small ask" },
    ];
    const deps: NlcLoopDeps = {
      llm: scriptedProvider("test-model", []),
      tools: [],
      executeTool: vi.fn(),
      options: { contextWindow: 100_000 },
    };
    const r = await phase2Transform(phase1FromMessages(messages), deps);
    expect(r.compressed).toBe(false);
    expect(r.compressedCount).toBe(0);
    expect(r.messages).toBe(messages);
  });

  it("compresses when token estimate exceeds the configured ratio", async () => {
    // Build a long conversation so estimateMessageTokens > 0.6 * window.
    const filler = "x".repeat(2000);
    const messages: LLMMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "task" },
    ];
    for (let i = 0; i < 30; i++) {
      messages.push({ role: "assistant", content: `t${i} ${filler}` });
      messages.push({ role: "tool", toolCallId: `id${i}`, content: `r${i} ${filler}` });
    }
    const deps: NlcLoopDeps = {
      llm: scriptedProvider("test-model", []),
      tools: [],
      executeTool: vi.fn(),
      options: { contextWindow: 8000, compressionRatio: 0.6 },
    };
    const r = await phase2Transform(phase1FromMessages(messages), deps);
    expect(r.compressed).toBe(true);
    expect(r.compressedCount).toBeGreaterThan(0);
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore);
  });
});

// --- Phase 3 ----------------------------------------------------------

describe("Phase 3 — react", () => {
  it("returns done with the final text when no tool calls are emitted", async () => {
    const llm = scriptedProvider("test", [
      { text: "all done", finishReason: "stop" },
    ]);
    const phase2: Phase2Result = {
      messages: [{ role: "user", content: "hello" }],
      compressed: false,
      compressedCount: 0,
      tokensBefore: 0,
      tokensAfter: 0,
    };
    const r = await phase3ReactLoop(phase2, {
      llm,
      tools: TOOLS,
      executeTool: vi.fn(),
    });
    expect(r.state).toBe("done");
    expect(r.finalText).toBe("all done");
    expect(r.turns).toBe(1);
    expect(r.toolCalls).toBe(0);
  });

  it("loops through tool calls and stops on the final text", async () => {
    const llm = scriptedProvider("test", [
      {
        text: "calling echo",
        toolCalls: [{ id: "call-1", name: "echo", args: { text: "ping" } }],
        finishReason: "tool_use",
      },
      { text: "result was: pong", finishReason: "stop" },
    ]);
    const executeTool = vi.fn(async (call: LLMToolCall) => {
      void call;
      return JSON.stringify({ ok: true, echo: "pong" });
    });
    const r = await phase3ReactLoop(
      {
        messages: [{ role: "user", content: "echo ping please" }],
        compressed: false,
        compressedCount: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      },
      { llm, tools: TOOLS, executeTool },
    );
    expect(r.state).toBe("done");
    expect(r.finalText).toBe("result was: pong");
    expect(r.turns).toBe(2);
    expect(r.toolCalls).toBe(1);
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("aborts immediately when the signal is already triggered", async () => {
    const controller = new AbortController();
    controller.abort();
    const llm = scriptedProvider("test", [
      { text: "should never reach", finishReason: "stop" },
    ]);
    const r = await phase3ReactLoop(
      {
        messages: [{ role: "user", content: "hi" }],
        compressed: false,
        compressedCount: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      },
      {
        llm,
        tools: TOOLS,
        executeTool: vi.fn(),
        options: { signal: controller.signal },
      },
    );
    expect(r.state).toBe("cancelled");
    expect(r.turns).toBe(0);
  });

  it("returns failed on LLM stream error", async () => {
    const llm = scriptedProvider("test", [
      { text: "", finishReason: "error", errorMessage: "boom" },
    ]);
    const r = await phase3ReactLoop(
      {
        messages: [{ role: "user", content: "hi" }],
        compressed: false,
        compressedCount: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      },
      { llm, tools: TOOLS, executeTool: vi.fn() },
    );
    expect(r.state).toBe("failed");
    expect(r.failureReason).toBe("boom");
  });

  it(
    "classifies stream-abort as cancelled, not failed (M3): the real OpenAI/Anthropic " +
      "providers catch AbortError and yield { type:'error', message:'Request aborted' }; " +
      "without the signal-aborted check ordered before the finishReason==='error' branch, " +
      "a user-clicked Stop during streaming would show as 'failed' in the UI.",
    async () => {
      const controller = new AbortController();
      // Provider that aborts the controller mid-stream then yields the
      // in-band 'Request aborted' error chunk — exactly what
      // openai-compatible.ts:184 and anthropic.ts:194 do on AbortError.
      const llm: ChatLLMProvider = {
        name: "abort-mid-stream",
        model: "test",
        contextWindow: 100_000,
        chat: () => {
          return (async function* (): AsyncGenerator<LLMChunk> {
            controller.abort();
            yield { type: "error", message: "Request aborted" };
          })();
        },
        complete: async () => ({
          text: "",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        }),
      };
      const r = await phase3ReactLoop(
        {
          messages: [{ role: "user", content: "hi" }],
          compressed: false,
          compressedCount: 0,
          tokensBefore: 0,
          tokensAfter: 0,
        },
        {
          llm,
          tools: TOOLS,
          executeTool: vi.fn(),
          options: { signal: controller.signal },
        },
      );
      expect(r.state).toBe("cancelled");
      // Must NOT be failed: failure metrics treat 'cancelled' as user
      // intent and exclude it from health dashboards.
      expect(r.state).not.toBe("failed");
    },
  );
});

// --- runNlcLoop (full pipeline) ---------------------------------------

describe("runNlcLoop", () => {
  it("auto-injects invoke_skill and never delegates it to executeTool", async () => {
    const globalRoot = tempDir("nlc-global-");
    const workspace = tempDir("nlc-ws-");
    writeFile(
      globalRoot,
      "skills/code-review.md",
      "---\nname: code-review\ndescription: review staged changes\n---\nFOLLOW THESE STEPS:\n1. read the diff\n2. flag CRITICAL items",
    );

    const llm = scriptedProvider("test", [
      {
        text: "let me pull the skill",
        toolCalls: [{ id: "c1", name: "invoke_skill", args: { name: "code-review" } }],
        finishReason: "tool_use",
      },
      { text: "review complete", finishReason: "stop" },
    ]);
    const executeTool = vi.fn(async (_call: LLMToolCall) => "executor was called");

    const outcome = await runNlcLoop(
      { currentMessage: "review my changes", workspaceRoot: workspace },
      {
        llm,
        tools: TOOLS,
        executeTool,
        options: { globalRoot },
      },
    );

    expect(outcome.state).toBe("done");
    // The caller's executeTool MUST NOT have been asked about invoke_skill.
    expect(executeTool).not.toHaveBeenCalled();
    // The invoke_skill result was the skill body.
    const lastTool = outcome.finalMessages.find((m) => m.role === "tool");
    expect(lastTool?.content).toContain("FOLLOW THESE STEPS");
    // And the catalogue (description) made it into the system prompt.
    const sys = outcome.finalMessages[0]!.content as string;
    expect(sys).toContain("Available skills");
    expect(sys).toContain("code-review");
  });

  it("returns the Phase 2 token stats on the outcome", async () => {
    const workspace = tempDir("nlc-ws-");
    const globalRoot = tempDir("nlc-global-");
    const llm = scriptedProvider("test", [{ text: "done", finishReason: "stop" }]);
    const outcome = await runNlcLoop(
      { currentMessage: "hi", workspaceRoot: workspace },
      {
        llm,
        tools: [],
        executeTool: vi.fn(),
        options: { globalRoot, contextWindow: 100_000 },
      },
    );
    expect(outcome.state).toBe("done");
    expect(outcome.tokensBefore).toBeGreaterThan(0);
    expect(outcome.tokensAfter).toBe(outcome.tokensBefore);
    expect(outcome.compressedCount).toBe(0);
  });
});

describe("composeSystemMessage", () => {
  it("falls back to just the built-in prompt when nothing else is set", () => {
    const inputs: ContextInputs = {
      builtin: "BASE",
      globalSystem: null,
      projectSystem: null,
      globalAgents: null,
      projectAgents: null,
      skills: [],
      augmentation: "",
    };
    expect(composeSystemMessage(inputs)).toBe("BASE");
  });
});
