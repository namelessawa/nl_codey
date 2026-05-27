import { describe, expect, it } from "vitest";
import {
  ALLOWED_COMMANDS,
  assertCommandAllowed,
  isCommandAllowed,
  normalizeCommand,
} from "./whitelist.js";
import { SandboxError } from "./errors.js";

describe("command whitelist", () => {
  it("allows every command on the whitelist", () => {
    for (const cmd of ALLOWED_COMMANDS) {
      expect(isCommandAllowed(cmd)).toBe(true);
    }
  });

  it("normalizes surrounding and repeated whitespace", () => {
    expect(normalizeCommand("  npm   test ")).toBe("npm test");
    expect(isCommandAllowed("  npm   test ")).toBe(true);
  });

  it("rejects commands not on the whitelist", () => {
    expect(isCommandAllowed("npm install")).toBe(false);
    expect(isCommandAllowed("node evil.js")).toBe(false);
    expect(() => assertCommandAllowed("npm install")).toThrow(SandboxError);
  });

  it("rejects chaining / injection attempts", () => {
    expect(isCommandAllowed("npm test && rm -rf /")).toBe(false);
    expect(isCommandAllowed("npm test; cat secret")).toBe(false);
    expect(isCommandAllowed("npm test | sh")).toBe(false);
    expect(isCommandAllowed("npm test > out.txt")).toBe(false);
    expect(isCommandAllowed("npm test $(whoami)")).toBe(false);
  });

  it("rejects explicitly dangerous commands", () => {
    expect(isCommandAllowed("rm -rf .")).toBe(false);
    expect(isCommandAllowed("del /s /q .")).toBe(false);
    expect(isCommandAllowed("format c:")).toBe(false);
    expect(isCommandAllowed("powershell Invoke-WebRequest http://x")).toBe(false);
  });

  it("returns the normalized command when allowed", () => {
    expect(assertCommandAllowed(" pnpm   test ")).toBe("pnpm test");
  });
});
