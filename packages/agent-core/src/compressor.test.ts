import { describe, expect, it, vi } from "vitest";
import type { LLMMessage } from "@coding-agent/shared";
import { compressConversation, serializeMessages, shouldCompress } from "./compressor.js";

const SMALL_WINDOW = 100; // tokens — easy to exceed in tests

/** Build a conversation: system, first user task, then `pairs` assistant/tool rounds. */
function buildConversation(pairs: number, contentChars = 200): LLMMessage[] {
  const filler = "x".repeat(contentChars);
  const messages: LLMMessage[] = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "implement the feature" },
  ];
  for (let i = 0; i < pairs; i += 1) {
    messages.push({ role: "assistant", content: `step ${i} ${filler}` });
    messages.push({ role: "tool", toolCallId: `t${i}`, content: `result ${i} ${filler}` });
  }
  return messages;
}

describe("shouldCompress", () => {
  it("returns false when the conversation is well under the window", () => {
    const messages = buildConversation(1, 10);
    expect(shouldCompress(messages, 100_000)).toBe(false);
  });

  it("returns true once the estimate exceeds the trigger ratio", () => {
    const messages = buildConversation(20, 400);
    expect(shouldCompress(messages, SMALL_WINDOW)).toBe(true);
  });
});

describe("compressConversation", () => {
  it("returns null when below the compression trigger", async () => {
    const messages = buildConversation(1, 10);
    const summarize = vi.fn(async () => "summary");
    const result = await compressConversation(messages, 100_000, summarize);

    expect(result).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("folds the middle into a summary while preserving system, first user, and recent tail", async () => {
    const messages = buildConversation(20, 400); // 2 + 40 = 42 messages
    const summarize = vi.fn(async () => "CONDENSED HISTORY");

    const result = await compressConversation(messages, SMALL_WINDOW, summarize);

    expect(result).not.toBeNull();
    const compressed = result!.messages;
    // system + first user + summary + last 10 recent = 13
    expect(compressed).toHaveLength(13);
    expect(compressed[0]).toEqual({ role: "system", content: "system prompt" });
    expect(compressed[1]).toEqual({ role: "user", content: "implement the feature" });
    expect(compressed[2]).toEqual({
      role: "assistant",
      content: "[Previous context summary]\nCONDENSED HISTORY",
    });
    // The tail is the original last 10 messages, verbatim.
    expect(compressed.slice(3)).toEqual(messages.slice(messages.length - 10));
    expect(result!.compressedCount).toBe(messages.length - 2 - 10);
    expect(summarize).toHaveBeenCalledOnce();
  });

  it("returns null when there is no user message to anchor on", async () => {
    const messages: LLMMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: "assistant" as const,
      content: "y".repeat(400) + i,
    }));
    const summarize = vi.fn(async () => "summary");

    const result = await compressConversation(messages, SMALL_WINDOW, summarize);

    expect(result).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("returns null when the middle is too small to bother compressing", async () => {
    // Over the trigger via large recent tail, but fewer than 2 middle messages.
    const messages: LLMMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "x".repeat(2000) },
      { role: "assistant", content: "y".repeat(2000) },
    ];
    const summarize = vi.fn(async () => "summary");

    const result = await compressConversation(messages, SMALL_WINDOW, summarize);

    expect(result).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("feeds serialized middle messages to the summarizer", async () => {
    const messages = buildConversation(20, 400);
    let received = "";
    const summarize = vi.fn(async (text: string) => {
      received = text;
      return "summary";
    });

    await compressConversation(messages, SMALL_WINDOW, summarize);

    expect(received).toContain("assistant:");
    expect(received).toContain("tool[t0]:");
  });
});

describe("serializeMessages", () => {
  it("renders each role distinctly and names tool calls", () => {
    const text = serializeMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "calling",
        toolCalls: [{ id: "1", name: "read_file", args: {} }],
      },
      { role: "tool", toolCallId: "1", content: "file body" },
    ]);

    expect(text).toContain("user: hi");
    expect(text).toContain("assistant: calling (tool calls: read_file)");
    expect(text).toContain("tool[1]: file body");
  });
});
