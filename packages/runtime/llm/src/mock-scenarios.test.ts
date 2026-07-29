import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMChunk, LLMMessage, ToolSchema } from "@nlc/shared";
import { MockLLMProvider } from "./mock.js";

const TOOLS: ToolSchema[] = [
  { name: "run_command", description: "", parameters: { type: "object" } },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

async function collect(iterable: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

describe("MockLLMProvider deterministic scenarios", () => {
  it("emits numbered large output and stops without tools", async () => {
    vi.stubEnv("NLC_MOCK_SCENARIO", "large-output");
    const provider = new MockLLMProvider();

    const chunks = await collect(
      provider.chat({
        messages: [{ role: "user", content: "exercise scrollback" }],
        tools: TOOLS,
      }),
    );
    const text = chunks
      .filter((chunk) => chunk.type === "text_delta")
      .map((chunk) => (chunk.type === "text_delta" ? chunk.text : ""))
      .join("");

    expect(text.split("\n")).toHaveLength(80);
    expect(text).toContain("scrollback-line-001");
    expect(text).toContain("scrollback-line-080");
    expect(chunks.some((chunk) => chunk.type === "tool_call")).toBe(false);
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("reads one long tool fixture before emitting 320 message rows", async () => {
    vi.stubEnv("NLC_MOCK_SCENARIO", "large-tool-output");
    const provider = new MockLLMProvider();
    const messages: LLMMessage[] = [
      { role: "user", content: "exercise large tool output" },
    ];
    const first = await collect(
      provider.chat({
        messages,
        tools: [
          { name: "read_file", description: "", parameters: { type: "object" } },
        ],
      }),
    );

    expect(first.find((chunk) => chunk.type === "tool_call")).toMatchObject({
      name: "read_file",
      args: { path: "LONG_TOOL_OUTPUT.txt" },
    });

    const second = await collect(
      provider.chat({
        tools: TOOLS,
        messages: [
          ...messages,
          { role: "assistant", content: "read long output" },
          { role: "tool", toolCallId: "call_large_tool_output", content: "{}" },
        ],
      }),
    );
    const text = second
      .filter((chunk) => chunk.type === "text_delta")
      .map((chunk) => (chunk.type === "text_delta" ? chunk.text : ""))
      .join("");
    expect(text.split("\n")).toHaveLength(320);
    expect(text).toContain("bulk-message-row-001");
    expect(text).toContain("bulk-message-row-320");
    expect(second.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("emits a raw synthetic provider error for downstream redaction gates", async () => {
    const secret = "sk-" + "native-redaction-fixture-1234";
    vi.stubEnv("NLC_MOCK_SCENARIO", "redacted-error");
    vi.stubEnv("NLC_MOCK_ERROR_SECRET", secret);
    const provider = new MockLLMProvider();

    const chunks = await collect(
      provider.chat({
        messages: [{ role: "user", content: "exercise redaction" }],
        tools: TOOLS,
      }),
    );
    const error = chunks.find((chunk) => chunk.type === "error");

    expect(error).toMatchObject({ type: "error" });
    expect(error?.type === "error" ? error.message : "").toContain(secret);
    expect(chunks.some((chunk) => chunk.type === "tool_call")).toBe(false);
  });

  it("requests one whitelisted command and then stops", async () => {
    vi.stubEnv("NLC_MOCK_SCENARIO", "command-confirmation");
    const provider = new MockLLMProvider();
    const firstMessages: LLMMessage[] = [
      { role: "user", content: "exercise command confirmation" },
    ];
    const first = await collect(provider.chat({ messages: firstMessages, tools: TOOLS }));

    expect(first.find((chunk) => chunk.type === "tool_call")).toMatchObject({
      type: "tool_call",
      id: "call_command_1",
      name: "run_command",
      args: { command: "tsc --noEmit" },
    });
    expect(first.at(-1)).toMatchObject({ type: "finish", reason: "tool_use" });

    const second = await collect(
      provider.chat({
        tools: TOOLS,
        messages: [
          ...firstMessages,
          { role: "assistant", content: "requesting command" },
          {
            role: "tool",
            toolCallId: "call_command_1",
            content: '{"exitCode":1}',
          },
        ],
      }),
    );

    expect(second.some((chunk) => chunk.type === "tool_call")).toBe(false);
    expect(second.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });

  it("reads, searches, then forges a write for the read-only runtime guard", async () => {
    vi.stubEnv("NLC_MOCK_SCENARIO", "read-only-analysis");
    const provider = new MockLLMProvider();
    const messages: LLMMessage[] = [
      { role: "user", content: "analyze the fixture without changes" },
    ];
    const readOnlyTools: ToolSchema[] = [
      { name: "read_file", description: "", parameters: { type: "object" } },
      { name: "search_text", description: "", parameters: { type: "object" } },
    ];

    const read = await collect(
      provider.chat({ messages, tools: readOnlyTools }),
    );
    expect(read.find((chunk) => chunk.type === "tool_call")).toMatchObject({
      name: "read_file",
      args: { path: "README.md" },
    });

    const search = await collect(
      provider.chat({
        tools: readOnlyTools,
        messages: [
          ...messages,
          { role: "assistant", content: "read" },
          { role: "tool", toolCallId: "call_read_only_read", content: "{}" },
        ],
      }),
    );
    expect(search.find((chunk) => chunk.type === "tool_call")).toMatchObject({
      name: "search_text",
      args: { query: "READ_ONLY_ANALYSIS_MARKER" },
    });

    const forged = await collect(
      provider.chat({
        tools: readOnlyTools,
        messages: [
          ...messages,
          { role: "assistant", content: "read" },
          { role: "tool", toolCallId: "call_read_only_read", content: "{}" },
          { role: "assistant", content: "search" },
          { role: "tool", toolCallId: "call_read_only_search", content: "{}" },
        ],
      }),
    );
    expect(forged.find((chunk) => chunk.type === "tool_call")).toMatchObject({
      name: "apply_patch",
    });
    expect(readOnlyTools.some((tool) => tool.name === "apply_patch")).toBe(false);

    const finished = await collect(
      provider.chat({
        tools: readOnlyTools,
        messages: [
          ...messages,
          { role: "assistant", content: "read" },
          { role: "tool", toolCallId: "call_read_only_read", content: "{}" },
          { role: "assistant", content: "search" },
          { role: "tool", toolCallId: "call_read_only_search", content: "{}" },
          { role: "assistant", content: "forged write" },
          {
            role: "tool",
            toolCallId: "call_read_only_forged_write",
            content: "read-only refusal",
          },
        ],
      }),
    );
    const text = finished
      .filter((chunk) => chunk.type === "text_delta")
      .map((chunk) => (chunk.type === "text_delta" ? chunk.text : ""))
      .join("");
    expect(text).toContain("forged apply_patch was refused");
    expect(finished.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });
});
