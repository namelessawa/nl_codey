import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileRangeTool } from "./read-file-range.js";
import { ToolError } from "./errors.js";

let root: string;
const ctx = (workspaceRoot: string) => ({ workspaceRoot, runId: "run-1" });

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "read-range-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("readFileRangeTool", () => {
  it("returns an inclusive 1-indexed slice with the total line count", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "l1\nl2\nl3\nl4\nl5\n");
    const out = await readFileRangeTool.run({ path: "a.txt", startLine: 2, endLine: 4 }, ctx(root));
    expect(out.content).toBe("l2\nl3\nl4");
    expect(out.startLine).toBe(2);
    expect(out.endLine).toBe(4);
    expect(out.totalLines).toBe(6); // trailing newline yields a final empty element
  });

  it("rejects an invalid range", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x\n");
    await expect(
      readFileRangeTool.run({ path: "a.txt", startLine: 5, endLine: 2 }, ctx(root)),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it("rejects an over-large range", async () => {
    fs.writeFileSync(path.join(root, "a.txt"), "x\n");
    await expect(
      readFileRangeTool.run({ path: "a.txt", startLine: 1, endLine: 1000 }, ctx(root)),
    ).rejects.toBeInstanceOf(ToolError);
  });
});
