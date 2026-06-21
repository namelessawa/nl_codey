import type { LanguagePreference, LLMMessage } from "@nlc/shared";
import { estimateMessageTokens } from "@nlc/shared";

/** Trigger compression when the estimate exceeds this fraction of the window. */
const COMPRESS_TRIGGER_RATIO = 0.6;
/** Number of most-recent messages preserved verbatim. */
const KEEP_RECENT = 10;

const SUMMARIZE_PROMPT_ZH = `你是一个对话上下文压缩器。请将下面的 NL_Codey 历史对话压缩成简洁摘要。
必须保留：
- 用户最初的任务目标。
- 已经探索过的文件路径和关键发现。
- 已经尝试过的 patch 和失败原因。
- 测试失败的关键错误信息。
- 仍未解决的问题。
不要保留：
- 完整文件内容。
- 重复的工具调用细节。
- 中间思考过程。
输出格式：纯文本，结构清晰，不超过 800 字。`;

const SUMMARIZE_PROMPT_EN = `You are a conversation-context compressor. Compress the following NL_Codey history into a concise summary.

Must preserve:
- The user's original task goal.
- File paths that have been explored and key findings.
- Patches that were attempted and the reasons they failed.
- Key error messages from test failures.
- Problems that remain unresolved.

Do not preserve:
- Full file contents.
- Duplicate tool-call details.
- Intermediate reasoning.

Output format: plain text, clearly structured, no more than 800 words.`;

/** Get the summarisation prompt in the requested language. */
export function getSummarizePrompt(lang: LanguagePreference): string {
  return lang === "en-US" ? SUMMARIZE_PROMPT_EN : SUMMARIZE_PROMPT_ZH;
}

/**
 * Backwards-compatible default — existing imports of `SUMMARIZE_PROMPT`
 * resolve to the Chinese prompt (the original behaviour). New callers should
 * use {@link getSummarizePrompt} with the user's language preference.
 */
export const SUMMARIZE_PROMPT = SUMMARIZE_PROMPT_ZH;

/** True when the conversation is large enough to warrant compression. */
export function shouldCompress(messages: LLMMessage[], contextWindow: number): boolean {
  return estimateMessageTokens(messages) > contextWindow * COMPRESS_TRIGGER_RATIO;
}

export type CompressionResult = {
  messages: LLMMessage[];
  /** How many middle messages were folded into the summary. */
  compressedCount: number;
};

/**
 * Compress the middle of a conversation into a summary while preserving the
 * system prompt, the original user task, and the most recent messages. Returns
 * null when there is nothing worth compressing (too few middle messages or
 * already under the trigger). `summarize` produces the summary text.
 */
export async function compressConversation(
  messages: LLMMessage[],
  contextWindow: number,
  summarize: (text: string) => Promise<string>,
): Promise<CompressionResult | null> {
  if (!shouldCompress(messages, contextWindow)) return null;

  const systemMessages = messages.filter((m) => m.role === "system");
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return null;
  const firstUser = messages[firstUserIdx];
  if (!firstUser) return null;

  // The compressible middle excludes system msgs, the first user msg, and the tail.
  let tailStart = Math.max(firstUserIdx + 1, messages.length - KEEP_RECENT);
  // A `tool` message must follow an `assistant` message with matching `tool_calls`
  // (enforced by OpenAI / DeepSeek / Anthropic). If `tailStart` lands on a `tool`
  // message, its parent assistant is in the middle and gets folded into the
  // summary — the result is an orphan `tool` at the head of `recent` and the
  // next API call rejects the request with 400. Advance `tailStart` past any
  // leading `tool` messages so `recent` always begins with a self-contained
  // message (system/user/assistant).
  while (tailStart < messages.length && messages[tailStart]?.role === "tool") {
    tailStart += 1;
  }
  const middle = messages.slice(firstUserIdx + 1, tailStart);
  if (middle.length < 2) return null; // not enough to bother

  const recent = messages.slice(tailStart);
  const summaryText = await summarize(serializeMessages(middle));

  const compressed: LLMMessage[] = [
    ...systemMessages,
    firstUser,
    { role: "assistant", content: `[Previous context summary]\n${summaryText}` },
    ...recent,
  ];
  return { messages: compressed, compressedCount: middle.length };
}

/** Render messages as plain text for the summarizer input. */
export function serializeMessages(messages: LLMMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "tool") return `tool[${m.toolCallId}]: ${m.content}`;
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const calls = m.toolCalls.map((c) => c.name).join(", ");
        return `assistant: ${m.content} (tool calls: ${calls})`;
      }
      return `${m.role}: ${m.content}`;
    })
    .join("\n");
}
