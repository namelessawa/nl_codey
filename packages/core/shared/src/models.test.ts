import { describe, it, expect } from "vitest";
import {
  computeCostUsd,
  contextWindowFor,
  DEFAULT_CONTEXT_WINDOW,
  estimateMessageTokens,
  estimateTokens,
  pricingFor,
} from "./models.js";

describe("pricingFor", () => {
  it("resolves a known model exactly", () => {
    expect(pricingFor("gpt-4o")).toEqual({ inputPerMillion: 2.5, outputPerMillion: 10 });
  });

  it("resolves by longest known prefix for dated model ids", () => {
    // OpenAI/Anthropic often append dates; prefix match should still price it.
    expect(pricingFor("claude-3-5-sonnet-20241022")).toEqual({
      inputPerMillion: 3,
      outputPerMillion: 15,
    });
  });

  it("returns zero pricing for an unknown model", () => {
    expect(pricingFor("totally-unknown-model")).toEqual({
      inputPerMillion: 0,
      outputPerMillion: 0,
    });
  });
});

describe("computeCostUsd", () => {
  it("computes cost from per-million pricing", () => {
    // gpt-4o: 1000 in * 2.5/1M + 2000 out * 10/1M = 0.0025 + 0.02 = 0.0225
    expect(computeCostUsd("gpt-4o", 1000, 2000)).toBeCloseTo(0.0225, 6);
  });

  it("is zero for unknown models", () => {
    expect(computeCostUsd("unknown", 1_000_000, 1_000_000)).toBe(0);
  });

  it("never goes negative on bad token counts", () => {
    expect(computeCostUsd("gpt-4o", -10, -10)).toBe(0);
  });
});

describe("contextWindowFor", () => {
  it("returns the known window", () => {
    expect(contextWindowFor("claude-sonnet-4")).toBe(200_000);
  });

  it("falls back to the default for unknown models", () => {
    expect(contextWindowFor("mystery-model")).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("token estimation", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("12345678")).toBe(2);
  });

  it("sums message content with per-message overhead", () => {
    const tokens = estimateMessageTokens([{ content: "12345678" }, { content: "1234" }]);
    // 2 + 4 overhead + 1 + 4 overhead = 11
    expect(tokens).toBe(11);
  });
});
