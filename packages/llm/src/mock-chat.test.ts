import { describe, expect, it } from "vitest";
import type { LLMChunk, LLMMessage, ToolSchema } from "@coding-agent/shared";
import { MockLLMProvider } from "./mock.js";

const TOOLS: ToolSchema[] = [
  { name: "list_files", description: "", parameters: { type: "object" } },
  { name: "apply_patch", description: "", parameters: { type: "object" } },
];

async function collect(it: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const out: LLMChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function toolNames(chunks: LLMChunk[]): string[] {
  return chunks.filter((c) => c.type === "tool_call").map((c) => (c as { name: string }).name);
}

describe("MockLLMProvider.chat", () => {
  it("turn 0 explores with list_files", async () => {
    const messages: LLMMessage[] = [{ role: "user", content: "do a thing" }];
    const chunks = await collect(new MockLLMProvider().chat({ messages, tools: TOOLS }));
    expect(toolNames(chunks)).toEqual(["list_files"]);
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "tool_use" });
  });

  it("turn 1 applies a patch", async () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "do a thing" },
      { role: "assistant", content: "exploring" },
      { role: "tool", toolCallId: "call_list", content: '{"files":["a.ts"]}' },
    ];
    const chunks = await collect(new MockLLMProvider().chat({ messages, tools: TOOLS }));
    expect(toolNames(chunks)).toEqual(["apply_patch"]);
    const call = chunks.find((c) => c.type === "tool_call");
    expect((call as { args: { patch: string } }).args.patch).toContain("AGENT_NOTES.md");
  });

  it("emits a repair patch when a prior command failed", async () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "fix it" },
      { role: "assistant", content: "exploring" },
      { role: "tool", toolCallId: "call_list", content: '{"files":["a.ts"]}' },
      { role: "assistant", content: "patching" },
      { role: "tool", toolCallId: "call_cmd", content: '{"exitCode":1,"stderr":"boom"}' },
    ];
    const chunks = await collect(new MockLLMProvider().chat({ messages, tools: TOOLS }));
    expect(toolNames(chunks)).toEqual(["apply_patch"]);
    const call = chunks.find((c) => c.type === "tool_call");
    expect((call as { args: { patch: string } }).args.patch).toContain("AGENT_FIX.md");
  });

  it("finishes with a summary once checks pass", async () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "fix it" },
      { role: "assistant", content: "exploring" },
      { role: "tool", toolCallId: "call_list", content: '{"files":["a.ts"]}' },
      { role: "assistant", content: "patching" },
      { role: "tool", toolCallId: "call_cmd", content: '{"exitCode":0}' },
    ];
    const chunks = await collect(new MockLLMProvider().chat({ messages, tools: TOOLS }));
    expect(toolNames(chunks)).toEqual([]);
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("returns plain text when no tools are offered", async () => {
    const chunks = await collect(
      new MockLLMProvider().chat({ messages: [{ role: "user", content: "summarize" }] }),
    );
    expect(toolNames(chunks)).toEqual([]);
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });
});
