import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject } from "./detect.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("detectProject", () => {
  it("detects pnpm Node projects and only suggests implemented scripts", () => {
    const root = tempRoot();
    writeJson(root, "package.json", {
      scripts: { test: "vitest", build: "tsc", lint: "eslint ." },
    });
    touch(root, "pnpm-lock.yaml");
    touch(root, "tsconfig.json");

    expect(detectProject(root)).toEqual({
      kind: "node",
      suggestedCommands: ["pnpm test", "pnpm build", "npx tsc --noEmit"],
    });
  });

  it("selects yarn or npm commands from lockfile evidence", () => {
    const yarn = tempRoot();
    writeJson(yarn, "package.json", { scripts: { build: "vite build" } });
    touch(yarn, "yarn.lock");
    expect(detectProject(yarn)).toEqual({
      kind: "node",
      suggestedCommands: ["yarn build"],
    });

    const npm = tempRoot();
    writeJson(npm, "package.json", { scripts: { test: "node test.js" } });
    expect(detectProject(npm)).toEqual({
      kind: "node",
      suggestedCommands: ["npm test"],
    });
  });

  it("keeps malformed package metadata non-fatal", () => {
    const root = tempRoot();
    fs.writeFileSync(path.join(root, "package.json"), "{invalid", "utf8");
    expect(detectProject(root)).toEqual({
      kind: "node",
      suggestedCommands: [],
    });
  });

  it.each([
    ["python", "pyproject.toml", "pytest"],
    ["python", "pytest.ini", "pytest"],
    ["go", "go.mod", "go test ./..."],
    ["rust", "Cargo.toml", "cargo test"],
  ] as const)("detects %s projects from %s", (kind, manifest, command) => {
    const root = tempRoot();
    touch(root, manifest);
    expect(detectProject(root)).toEqual({
      kind,
      suggestedCommands: [command],
    });
  });

  it("uses documented Node→Python→Go→Rust precedence for polyglot roots", () => {
    const root = tempRoot();
    writeJson(root, "package.json", { scripts: { test: "vitest" } });
    for (const manifest of ["pyproject.toml", "go.mod", "Cargo.toml"]) {
      touch(root, manifest);
    }

    expect(detectProject(root)).toEqual({
      kind: "node",
      suggestedCommands: ["npm test"],
    });
  });

  it("returns unknown for empty or missing roots without throwing", () => {
    expect(detectProject(tempRoot())).toEqual({
      kind: "unknown",
      suggestedCommands: [],
    });
    expect(detectProject(path.join(tempRoot(), "missing"))).toEqual({
      kind: "unknown",
      suggestedCommands: [],
    });
  });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-project-detect-"));
  roots.push(root);
  return root;
}

function touch(root: string, relativePath: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "", "utf8");
}

function writeJson(
  root: string,
  relativePath: string,
  value: unknown,
): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value), "utf8");
}
