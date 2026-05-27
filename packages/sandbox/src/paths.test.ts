import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertInsideWorkspace } from "./paths.js";
import { SandboxError } from "./errors.js";

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-paths-"));
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(base, "root-")));
  outside = fs.realpathSync.native(fs.mkdtempSync(path.join(base, "outside-")));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
});

afterAll(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe("assertInsideWorkspace", () => {
  it("accepts a relative path inside the workspace", () => {
    const resolved = assertInsideWorkspace(root, "src/a.ts");
    expect(resolved).toBe(path.join(root, "src", "a.ts"));
  });

  it("accepts the workspace root itself", () => {
    expect(assertInsideWorkspace(root, ".")).toBe(root);
  });

  it("accepts a not-yet-existing file inside the workspace", () => {
    const resolved = assertInsideWorkspace(root, "src/new-file.ts");
    expect(resolved).toBe(path.join(root, "src", "new-file.ts"));
  });

  it("rejects a parent-traversal escape", () => {
    expect(() => assertInsideWorkspace(root, "../outside-x/secret.txt")).toThrow(SandboxError);
  });

  it("rejects an absolute path outside the workspace", () => {
    expect(() => assertInsideWorkspace(root, path.join(outside, "secret.txt"))).toThrow(SandboxError);
  });

  it("rejects a symlink that escapes the workspace", () => {
    const link = path.join(root, "escape-link");
    try {
      fs.symlinkSync(outside, link, "dir");
    } catch {
      // Symlink creation can require privileges on Windows; skip if unavailable.
      return;
    }
    expect(() => assertInsideWorkspace(root, "escape-link/secret.txt")).toThrow(SandboxError);
  });
});
