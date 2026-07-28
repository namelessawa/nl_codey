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
});
