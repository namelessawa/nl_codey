import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMChunk } from "@nlc/shared";
import { AnthropicProvider } from "./anthropic.js";

function sseResponse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const payload = typeof e === "string" ? e : JSON.stringify(e);
        controller.enqueue(enc.encode(`event: x\ndata: ${payload}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(it: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const out: LLMChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function provider(): AnthropicProvider {
  return new AnthropicProvider({
    apiKey: "sk-ant-test",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4",
    temperature: 0.2,
    maxTokens: 1024,
    timeoutSeconds: 30,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("AnthropicProvider.chat", () => {
  it("streams text and assembles a tool_use block from input_json_delta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Read" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ing" } },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "read_file" } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path"' } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: ':"a.ts"}' } },
          { type: "content_block_stop", index: 1 },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
          { type: "message_stop" },
        ]),
      ),
    );

    const chunks = await collect(provider().chat({ messages: [{ role: "user", content: "go" }], tools: [] }));

    const text = chunks.filter((c) => c.type === "text_delta").map((c) => (c as { text: string }).text).join("");
    expect(text).toBe("Reading");

    const toolCall = chunks.find((c) => c.type === "tool_call");
    expect(toolCall).toMatchObject({ type: "tool_call", id: "toolu_1", name: "read_file", args: { path: "a.ts" } });

    const finishChunk = chunks.find((c) => c.type === "finish");
    expect(finishChunk).toMatchObject({ type: "finish", reason: "tool_use" });
    if (finishChunk?.type === "finish") {
      expect(finishChunk.usage.inputTokens).toBe(12);
      expect(finishChunk.usage.outputTokens).toBe(7);
      expect(finishChunk.usage.costUsd).toBeGreaterThan(0);
    }
  });

  it("finishes with stop on end_turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { type: "message_start", message: { usage: { input_tokens: 3 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
          { type: "message_stop" },
        ]),
      ),
    );

    const chunks = await collect(provider().chat({ messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
  });
});
