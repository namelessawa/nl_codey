import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redaction.js";

describe("redactSensitiveText", () => {
  it("redacts exact keys, headers, tokens, URL credentials and sensitive queries", () => {
    const secret = "custom-provider-key-123456";
    const result = redactSensitiveText(
      new Error(
        `key=${secret}; Authorization: Basic basic-value; Bearer bearer-value; ` +
          "X-API-Key: header-value; https://demo:password@example.test/run" +
          "?api_key=query-key&token=query-token; ghp_1234567890abcdef",
      ),
      { secrets: [secret] },
    );

    expect(result).toContain("[REDACTED]");
    for (const leaked of [
      secret,
      "basic-value",
      "bearer-value",
      "header-value",
      "demo:password",
      "query-key",
      "query-token",
      "ghp_1234567890abcdef",
    ]) {
      expect(result).not.toContain(leaked);
    }
  });

  it("redacts Windows, macOS and Linux home paths without Node-only APIs", () => {
    const result = redactSensitiveText(
      "C:\\Users\\alice\\.ssh\\id_rsa /home/bob/.npmrc /Users/carol/.config " +
        "D:/profiles/dan/private",
      { homePaths: ["D:\\profiles\\dan"] },
    );

    expect(result.match(/\[USER_HOME\]/g)).toHaveLength(4);
    expect(result).not.toMatch(/alice|bob|carol|dan/);
  });

  it("removes terminal controls, bounds output, and handles hostile conversion", () => {
    const hostile = {
      toString() {
        throw new Error("conversion secret");
      },
    };
    const controlled = redactSensitiveText(`\u001b[31mboom\u001b[0m ${"x".repeat(500)}`, {
      maxLength: 96,
    });

    expect(controlled).not.toContain("\u001b");
    expect(controlled.length).toBeLessThanOrEqual(96);
    expect(controlled).toContain("truncated");
    expect(redactSensitiveText("long secret output", { maxLength: 8 })).toHaveLength(
      8,
    );
    expect(redactSensitiveText(hostile, { fallback: "safe fallback" })).toBe(
      "safe fallback",
    );
  });

  it("strips long OSC sequences in linear passes", () => {
    const repeatedControlText = "\u001b]".repeat(100_000);
    const terminated = redactSensitiveText(
      `before \u001b]0;${repeatedControlText}\u0007 after`,
    );
    const unterminated = redactSensitiveText(repeatedControlText, {
      maxLength: 128,
    });

    expect(terminated).toBe("before  after");
    expect(unterminated).not.toContain("\u001b");
    expect(unterminated.length).toBeLessThanOrEqual(128);
  });

  it("is idempotent", () => {
    const once = redactSensitiveText("token=abc123 Authorization: Bearer abc123");
    expect(redactSensitiveText(once)).toBe(once);
  });
});
