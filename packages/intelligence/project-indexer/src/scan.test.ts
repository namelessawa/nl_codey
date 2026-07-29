import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IGNORED_DIRS } from "./ignore.js";
import { scanFiles } from "./scan.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scanFiles", () => {
  it("returns deterministic workspace-relative POSIX paths breadth-first", async () => {
    const root = tempRoot();
    write(root, "z.ts", "z");
    write(root, "nested/b.ts", "b");
    write(root, "nested/a.py", "a");

    await expect(scanFiles(root)).resolves.toEqual([
      "nested/a.py",
      "nested/b.ts",
      "z.ts",
    ]);
  });

  it("skips all ignored directories including case variants", async () => {
    const root = tempRoot();
    write(root, "keep/source.ts", "keep");
    for (const directory of IGNORED_DIRS) {
      write(root, `${directory}/ignored.ts`, "ignored");
    }
    write(root, "NODE_MODULES/also-ignored.ts", "ignored");

    await expect(scanFiles(root)).resolves.toEqual(["keep/source.ts"]);
  });

  it("does not follow directory links outside or inside the workspace", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    write(root, "real/local.ts", "local");
    write(outside, "secret.ts", "outside");
    fs.symlinkSync(
      outside,
      path.join(root, "outside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.symlinkSync(
      path.join(root, "real"),
      path.join(root, "inside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(scanFiles(root)).resolves.toEqual(["real/local.ts"]);
  });

  it("enumerates binary files as paths without decoding their contents", async () => {
    const root = tempRoot();
    const binary = path.join(root, "assets", "image.bin");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, Buffer.from([0, 255, 1, 2]));

    await expect(scanFiles(root)).resolves.toEqual(["assets/image.bin"]);
  });

  it("clamps caller limits to the hard 500-file boundary", async () => {
    const root = tempRoot();
    for (let index = 0; index < 510; index++) {
      write(root, `files/${String(index).padStart(3, "0")}.txt`, "x");
    }

    await expect(scanFiles(root, 1_000)).resolves.toHaveLength(500);
    await expect(scanFiles(root, Number.POSITIVE_INFINITY)).resolves.toHaveLength(
      500,
    );
    await expect(scanFiles(root, -1)).resolves.toEqual([]);
  });

  it("returns an empty result for missing or unreadable roots", async () => {
    const root = path.join(tempRoot(), "missing");
    await expect(scanFiles(root)).resolves.toEqual([]);
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-project-index-"));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}
