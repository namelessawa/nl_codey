import { describe, expect, it } from "vitest";
import { parseLiveLLMConfig } from "./live-llm-config.js";

describe("parseLiveLLMConfig", () => {
  it("parses the ignored custom provider fields", () => {
    const config = parseLiveLLMConfig(
      [
        "# explicit live smoke",
        "CUSTOM_API_KEY='synthetic-secret'",
        "CUSTOM_BASE_URL=https://llm.example.test/v1",
        'CUSTOM_MODEL="custom-model"',
      ].join("\r\n"),
    );

    expect(config).toEqual({
      provider: "custom",
      apiKey: "synthetic-secret",
      baseUrl: "https://llm.example.test/v1",
      model: "custom-model",
      temperature: 0,
      maxTokens: 2_048,
      timeoutSeconds: 120,
    });
  });

  it.each([
    ["missing field", "CUSTOM_API_KEY=synthetic-secret\nCUSTOM_MODEL=model"],
    [
      "duplicate field",
      "CUSTOM_API_KEY=synthetic-secret\nCUSTOM_API_KEY=second-secret\n" +
        "CUSTOM_BASE_URL=https://example.test/v1\nCUSTOM_MODEL=model",
    ],
    [
      "unsupported field",
      "CUSTOM_API_KEY=synthetic-secret\nCUSTOM_BASE_URL=https://example.test/v1\n" +
        "CUSTOM_MODEL=model\nEXTRA_SECRET=do-not-print",
    ],
    [
      "embedded URL credentials",
      "CUSTOM_API_KEY=synthetic-secret\n" +
        "CUSTOM_BASE_URL=https://username:url-secret@example.test/v1\nCUSTOM_MODEL=model",
    ],
  ])("rejects %s without echoing configured values", (_label, raw) => {
    let caught: unknown;
    try {
      parseLiveLLMConfig(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(
      /synthetic-secret|second-secret|do-not-print|url-secret|username/,
    );
  });
});
