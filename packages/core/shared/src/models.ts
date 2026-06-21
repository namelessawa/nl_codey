/**
 * Per-model pricing (USD per 1M tokens) and context windows, plus cost and
 * token-estimate helpers. Shared so providers, the budget controller, and the
 * context compressor all agree on the numbers.
 */

export type ModelPricing = {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
};

/** Known model pricing. Unknown models fall back to zero cost. */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4.1": { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  "deepseek-chat": { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  "deepseek-reasoner": { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Known context windows (tokens). Unknown models use {@link DEFAULT_CONTEXT_WINDOW}. */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-haiku": 200_000,
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
};

/** Resolve a table entry by exact match, then by the longest known prefix. */
function resolve<T>(model: string, table: Record<string, T>): T | undefined {
  const exact = table[model];
  if (exact !== undefined) return exact;
  const keys = Object.keys(table)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length);
  const key = keys[0];
  return key !== undefined ? table[key] : undefined;
}

export function pricingFor(model: string): ModelPricing {
  return resolve(model, MODEL_PRICING) ?? { inputPerMillion: 0, outputPerMillion: 0 };
}

export function contextWindowFor(model: string): number {
  return resolve(model, MODEL_CONTEXT_WINDOWS) ?? DEFAULT_CONTEXT_WINDOW;
}

/** Compute USD cost for a turn, rounded to micro-dollar precision. */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricingFor(model);
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * p.inputPerMillion +
    (Math.max(0, outputTokens) / 1_000_000) * p.outputPerMillion;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Rough token estimate: ~4 characters per token. Used for compression triggers. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/** Estimate tokens across messages, adding a small per-message overhead. */
export function estimateMessageTokens(messages: ReadonlyArray<{ content?: string }>): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content ?? "") + 4;
  return total;
}
