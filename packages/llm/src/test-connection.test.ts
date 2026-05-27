import { describe, it, expect, vi, afterEach } from "vitest";
import type { LLMConfig } from "@coding-agent/shared";
import { testLLMConnection } from "./test-connection.js";
import { createLLMProvider } from "./provider.js";

const baseConfig: LLMConfig = {
  provider: "openai",
  apiKey: "sk-test-secret-1234",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  temperature: 0.2,
  maxTokens: 4096,
  timeoutSeconds: 60,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("testLLMConnection", () => {
  it("fails fast when API key is missing", async () => {
    const result = await testLLMConnection({ ...baseConfig, apiKey: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("API Key");
  });

  it("returns success when the model replies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }),
      ),
    );
    const result = await testLLMConnection(baseConfig);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("连接成功");
  });

  it("returns a structured error on HTTP failure without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized for key sk-test-secret-1234", { status: 401 })),
    );
    const result = await testLLMConnection(baseConfig);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("sk-test-secret-1234");
  });
});

describe("createLLMProvider", () => {
  it("builds an OpenAI-compatible provider for deepseek", () => {
    const provider = createLLMProvider({ ...baseConfig, provider: "deepseek" });
    expect(provider.name).toBe("deepseek");
  });

  it("builds an Anthropic provider", () => {
    const provider = createLLMProvider({ ...baseConfig, provider: "anthropic" });
    expect(provider.name).toBe("anthropic");
  });

  it("throws a readable error when the key is missing", () => {
    expect(() => createLLMProvider({ ...baseConfig, apiKey: "" })).toThrow(/API key is required/i);
  });
});
