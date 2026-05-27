/** LLM provider abstraction. Implementations live in @coding-agent/llm. */

export type LLMRole = "system" | "user" | "assistant";

export type LLMMessage = {
  role: LLMRole;
  content: string;
};

export type LLMCompleteInput = {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Per-request abort signal (e.g. for run cancellation). */
  signal?: AbortSignal;
};

export type LLMCompleteOutput = {
  text: string;
};

export interface LLMProvider {
  readonly name: string;
  complete(input: LLMCompleteInput): Promise<LLMCompleteOutput>;
}
