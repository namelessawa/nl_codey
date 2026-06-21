import { describe, expect, it } from "vitest";
import { applyV4AHunks, isV4APatch, parseV4A } from "./v4a.js";
import { ToolError } from "./errors.js";

describe("isV4APatch", () => {
  it("detects the V4A envelope", () => {
    expect(isV4APatch("*** Begin Patch\n*** End Patch")).toBe(true);
    expect(isV4APatch("  \n*** Begin Patch")).toBe(true);
    expect(isV4APatch("--- a/x\n+++ b/x")).toBe(false);
  });
});

describe("parseV4A", () => {
  it("parses update, add, and delete operations", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@ function f",
      " const a = 1;",
      "-return a;",
      "+return a + 1;",
      "*** Add File: src/b.ts",
      "+export const b = 2;",
      "*** Delete File: src/old.ts",
      "*** End Patch",
    ].join("\n");

    const ops = parseV4A(patch);
    expect(ops).toHaveLength(3);

    const update = ops[0];
    expect(update).toMatchObject({ op: "update", path: "src/a.ts" });
    if (update?.op === "update") {
      expect(update.hunks[0]).toMatchObject({
        locator: "function f",
        oldLines: ["const a = 1;", "return a;"],
        newLines: ["const a = 1;", "return a + 1;"],
      });
    }
    expect(ops[1]).toEqual({ op: "add", path: "src/b.ts", content: "export const b = 2;" });
    expect(ops[2]).toEqual({ op: "delete", path: "src/old.ts" });
  });

  it("throws on a patch with no operations", () => {
    expect(() => parseV4A("*** Begin Patch\n*** End Patch")).toThrow(ToolError);
  });

  it("throws when the envelope is missing", () => {
    expect(() => parseV4A("just some text")).toThrow(ToolError);
  });
});

describe("applyV4AHunks", () => {
  it("replaces a matched context block", () => {
    const before = "const a = 1;\nreturn a;\nconst c = 3;\n";
    const ops = parseV4A(
      [
        "*** Begin Patch",
        "*** Update File: x.ts",
        " const a = 1;",
        "-return a;",
        "+return a + 1;",
        "*** End Patch",
      ].join("\n"),
    );
    const op = ops[0];
    if (op?.op !== "update") throw new Error("expected update");
    const after = applyV4AHunks(before, op.hunks, "x.ts");
    expect(after).toBe("const a = 1;\nreturn a + 1;\nconst c = 3;\n");
  });

  it("throws when the context cannot be located", () => {
    const ops = parseV4A(
      [
        "*** Begin Patch",
        "*** Update File: x.ts",
        " not in file;",
        "-gone;",
        "+new;",
        "*** End Patch",
      ].join("\n"),
    );
    const op = ops[0];
    if (op?.op !== "update") throw new Error("expected update");
    expect(() => applyV4AHunks("totally different\n", op.hunks, "x.ts")).toThrow(ToolError);
  });
});
