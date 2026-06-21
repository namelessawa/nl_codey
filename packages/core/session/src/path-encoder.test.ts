import { describe, expect, it } from "vitest";
import { encodeProjectFolder } from "./path-encoder.js";

describe("encodeProjectFolder", () => {
  it("converts a Windows path to single-dash form with drive letter intact", () => {
    expect(encodeProjectFolder("E:\\pythonproject\\coding-agent")).toBe(
      "E--pythonproject-coding-agent",
    );
  });

  it("preserves the leading slash marker on POSIX absolute paths", () => {
    expect(encodeProjectFolder("/home/user/projects/foo")).toBe(
      "-home-user-projects-foo",
    );
  });

  it("collapses repeated separators", () => {
    expect(encodeProjectFolder("E:\\\\foo//bar")).toBe("E--foo-bar");
  });

  it("replaces filesystem-illegal chars with underscore", () => {
    expect(encodeProjectFolder("C:\\proj?weird*name")).toBe("C--proj_weird_name");
  });

  it("never returns an empty string for a non-empty input", () => {
    expect(encodeProjectFolder(".")).toBe(".");
  });

  it("throws on empty input", () => {
    expect(() => encodeProjectFolder("")).toThrow(/required/);
  });

  it("is stable: same input → same output", () => {
    const a = encodeProjectFolder("E:\\pythonproject\\coding-agent");
    const b = encodeProjectFolder("E:\\pythonproject\\coding-agent");
    expect(a).toBe(b);
  });
});
