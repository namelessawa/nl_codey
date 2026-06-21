import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMChunk } from "@nlc/shared";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

/** Build a streaming Response from SSE event objects (one `data:` per event). */
function sseResponse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) {
        const payload = typeof e === "string" ? e : JSON.stringify(e);
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
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

function provider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    name: "openai",
    apiKey: "sk-test-key",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    temperature: 0.2,
    maxTokens: 1024,
    timeoutSeconds: 30,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAICompatibleProvider.chat", () => {
  it("streams text deltas and assembles a fragmented tool call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { choices: [{ delta: { content: "Hel" }, finish_reason: null }] },
          { choices: [{ delta: { content: "lo" }, finish_reason: null }] },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "list_files", arguments: '{"maxFiles"' } }] },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":50}" } }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
          "[DONE]",
        ]),
      ),
    );

    const chunks = await collect(provider().chat({ messages: [{ role: "user", content: "go" }], tools: [] }));

    const text = chunks.filter((c) => c.type === "text_delta").map((c) => (c as { text: string }).text).join("");
    expect(text).toBe("Hello");

    const toolCall = chunks.find((c) => c.type === "tool_call");
    expect(toolCall).toMatchObject({ type: "tool_call", name: "list_files", args: { maxFiles: 50 } });

    const finishChunk = chunks.find((c) => c.type === "finish");
    expect(finishChunk).toMatchObject({ type: "finish", reason: "tool_use" });
    if (finishChunk?.type === "finish") {
      expect(finishChunk.usage.inputTokens).toBe(10);
      expect(finishChunk.usage.outputTokens).toBe(5);
      // gpt-4o: 10 in * 2.5/1M (=0.000025) + 5 out * 10/1M (=0.00005) = 0.000075
      expect(finishChunk.usage.costUsd).toBeCloseTo(0.000075, 9);
    }
  });

  it("finishes with reason stop for a plain text response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { choices: [{ delta: { content: "done" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          "[DONE]",
        ]),
      ),
    );

    const chunks = await collect(provider().chat({ messages: [{ role: "user", content: "hi" }] }));
    expect(chunks.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
    expect(chunks.some((c) => c.type === "tool_call")).toBe(false);
  });

  it("emits an error chunk on a non-OK response and redacts the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad sk-test-key here", { status: 401 })),
    );

    const chunks = await collect(provider().chat({ messages: [{ role: "user", content: "hi" }] }));
    const err = chunks.find((c) => c.type === "error");
    expect(err?.type).toBe("error");
    if (err?.type === "error") {
      expect(err.message).toContain("401");
      expect(err.message).not.toContain("sk-test-key");
    }
  });
});
