import { describe, expect, it } from "vitest";
import { extractSymbols } from "./symbols.js";

describe("extractSymbols — TypeScript/JavaScript", () => {
  const src = [
    "export function alpha(a: number) {}",
    "async function beta() {}",
    "export class Gamma {}",
    "export interface Delta { x: number }",
    "export type Epsilon = string | number;",
    "export const zeta = (n: number) => n + 1;",
    "let local = 3;",
    "  // comment with function keyword",
  ].join("\n");

  it("extracts functions, classes, interfaces, types and consts with line numbers", () => {
    const symbols = extractSymbols("src/x.ts", src);
    const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));

    expect(byName.alpha).toMatchObject({ kind: "function", line: 1, exported: true });
    expect(byName.beta).toMatchObject({ kind: "function", line: 2, exported: false });
    expect(byName.Gamma).toMatchObject({ kind: "class", exported: true });
    expect(byName.Delta?.kind).toBe("interface");
    expect(byName.Epsilon?.kind).toBe("type");
    expect(byName.zeta?.kind).toBe("const");
    expect(byName.local?.exported).toBe(false);
  });

  it("ignores comment lines", () => {
    const symbols = extractSymbols("src/x.ts", src);
    expect(symbols.some((s) => s.signature.startsWith("//"))).toBe(false);
  });
});

describe("extractSymbols — Python", () => {
  it("marks underscore-prefixed names as not exported", () => {
    const symbols = extractSymbols("m.py", "def public():\n    pass\ndef _private():\n    pass\nclass Thing:\n    pass");
    const byName = Object.fromEntries(symbols.map((s) => [s.name, s]));
    expect(byName.public).toMatchObject({ kind: "function", exported: true });
    expect(byName._private?.exported).toBe(false);
    expect(byName.Thing?.kind).toBe("class");
  });
});

describe("extractSymbols — Go", () => {
  it("treats capitalized names as exported and detects struct/interface", () => {
    const src = "func Exported() {}\nfunc unexported() {}\ntype User struct {}\ntype Reader interface {}";
    const byName = Object.fromEntries(extractSymbols("m.go", src).map((s) => [s.name, s]));
    expect(byName.Exported?.exported).toBe(true);
    expect(byName.unexported?.exported).toBe(false);
    expect(byName.User?.kind).toBe("struct");
    expect(byName.Reader?.kind).toBe("interface");
  });
});

describe("extractSymbols — Rust", () => {
  it("uses pub to determine export and detects fn/struct/trait", () => {
    const src = "pub fn run() {}\nfn helper() {}\npub struct Config {}\npub trait Handler {}";
    const byName = Object.fromEntries(extractSymbols("m.rs", src).map((s) => [s.name, s]));
    expect(byName.run?.exported).toBe(true);
    expect(byName.helper?.exported).toBe(false);
    expect(byName.Config?.kind).toBe("struct");
    expect(byName.Handler?.kind).toBe("interface");
  });
});

describe("extractSymbols — unknown extension", () => {
  it("returns no symbols for unsupported file types", () => {
    expect(extractSymbols("notes.txt", "function foo() {}")).toEqual([]);
  });
});
