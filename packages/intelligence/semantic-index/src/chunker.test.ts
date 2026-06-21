import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker.js";

describe("chunkFile - code", () => {
  it("splits TypeScript at function/class boundaries and captures symbol names", () => {
    const content = [
      'import { x } from "./x.js";',
      "",
      "export function alpha() {",
      "  return 1;",
      "}",
      "",
      "class Beta {",
      "  method() {}",
      "}",
    ].join("\n");

    const chunks = chunkFile("src/sample.ts", content);
    const symbols = chunks.map((c) => c.symbolName).filter(Boolean);

    expect(symbols).toContain("alpha");
    expect(symbols).toContain("Beta");
    expect(chunks.every((c) => c.kind === "code")).toBe(true);
  });

  it("captures Python def and Go func and Rust fn symbols", () => {
    const py = chunkFile("a.py", "def compute(x):\n    return x");
    expect(py[0]?.symbolName).toBe("compute");

    const go = chunkFile("a.go", "func Handle() {\n}");
    expect(go[0]?.symbolName).toBe("Handle");

    const rs = chunkFile("a.rs", "fn run() {\n}");
    expect(rs[0]?.symbolName).toBe("run");
  });

  it("slices a long function into ~80-line windows", () => {
    const body = Array.from({ length: 200 }, (_, i) => `  let v${i} = ${i};`);
    const content = ["function big() {", ...body, "}"].join("\n");

    const chunks = chunkFile("big.ts", content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endLine - chunk.startLine + 1).toBeLessThanOrEqual(80);
    }
  });

  it("uses 1-indexed line numbers", () => {
    const chunks = chunkFile("x.ts", "function f() {\n  return 1;\n}");
    expect(chunks[0]?.startLine).toBe(1);
  });

  it("caps content at the char limit", () => {
    const huge = "function f() {\n" + "x".repeat(5000) + "\n}";
    const chunks = chunkFile("x.ts", huge);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(1500);
    }
  });
});

describe("chunkFile - markdown", () => {
  it("splits markdown on H2/H3 headings with doc kind", () => {
    const md = [
      "# Title",
      "intro",
      "## Section A",
      "content a",
      "### Sub B",
      "content b",
    ].join("\n");

    const chunks = chunkFile("README.md", md);
    expect(chunks.every((c) => c.kind === "doc")).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe("chunkFile - skipped files", () => {
  it("returns no chunks for non-indexed extensions", () => {
    expect(chunkFile("config.json", '{"a":1}')).toEqual([]);
    expect(chunkFile("data.yaml", "a: 1")).toEqual([]);
  });
});
