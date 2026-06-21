import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  maskApiKey,
  mergeSettings,
  toLLMConfig,
  validateSettings,
  type AppSettings,
} from "./settings.js";

function makeSettings(overrides: Partial<AppSettings["llm"]> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, ...overrides },
  };
}

describe("validateSettings", () => {
  it("accepts defaults with a valid base URL", () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("allows an empty API key (saving is permitted)", () => {
    const result = validateSettings(makeSettings({ apiKey: "" }));
    expect(result.valid).toBe(true);
  });

  it("rejects a non-http base URL", () => {
    const result = validateSettings(makeSettings({ baseUrl: "ftp://example.com" }));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "llm.baseUrl")).toBe(true);
  });

  it("rejects an empty model", () => {
    const result = validateSettings(makeSettings({ model: "  " }));
    expect(result.issues.some((i) => i.field === "llm.model")).toBe(true);
  });

  it("rejects temperature out of range", () => {
    expect(validateSettings(makeSettings({ temperature: 2.5 })).valid).toBe(false);
    expect(validateSettings(makeSettings({ temperature: -1 })).valid).toBe(false);
  });

  it("rejects non-integer maxTokens", () => {
    const result = validateSettings(makeSettings({ maxTokens: 10.5 }));
    expect(result.issues.some((i) => i.field === "llm.maxTokens")).toBe(true);
  });

  it("rejects timeout out of range", () => {
    expect(validateSettings(makeSettings({ timeoutSeconds: 0 })).valid).toBe(false);
    expect(validateSettings(makeSettings({ timeoutSeconds: 9999 })).valid).toBe(false);
  });
});

describe("maskApiKey", () => {
  it("returns a placeholder when empty", () => {
    expect(maskApiKey("")).toBe("(not set)");
  });

  it("masks all but the last 4 characters", () => {
    const masked = maskApiKey("sk-1234567890abcd");
    expect(masked.endsWith("abcd")).toBe(true);
    expect(masked).not.toContain("1234567890");
  });

  it("never reveals the full key", () => {
    const key = "sk-supersecretkey";
    expect(maskApiKey(key)).not.toBe(key);
  });
});

describe("mergeSettings", () => {
  it("fills missing groups from defaults", () => {
    const merged = mergeSettings({ llm: { ...DEFAULT_SETTINGS.llm, model: "gpt-4o" } });
    expect(merged.llm.model).toBe("gpt-4o");
    expect(merged.agent).toEqual(DEFAULT_SETTINGS.agent);
    expect(merged.ui).toEqual(DEFAULT_SETTINGS.ui);
  });

  it("returns full defaults for null", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("toLLMConfig", () => {
  it("extracts the provider-building subset", () => {
    const config = toLLMConfig(DEFAULT_SETTINGS.llm);
    expect(config.provider).toBe(DEFAULT_SETTINGS.llm.provider);
    expect(config).not.toHaveProperty("theme");
  });
});
