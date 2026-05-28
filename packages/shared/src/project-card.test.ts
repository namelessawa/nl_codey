import { describe, expect, it } from "vitest";
import { deriveProjectCard } from "./project-card.js";

describe("deriveProjectCard", () => {
  it("detects a pnpm + TypeScript node project", () => {
    const card = deriveProjectCard(["package.json", "pnpm-lock.yaml", "tsconfig.json", "src/a.ts", "src/b.ts"]);
    expect(card.kind).toBe("node");
    expect(card.markers).toContain("package.json");
    expect(card.markers).toContain("tsconfig.json");
    expect(card.suggestedCommands).toContain("pnpm test");
    expect(card.suggestedCommands).toContain("npx tsc --noEmit");
    expect(card.fileCount).toBe(5);
  });

  it("detects python, go, and rust by marker files", () => {
    expect(deriveProjectCard(["pyproject.toml"]).kind).toBe("python");
    expect(deriveProjectCard(["go.mod"]).kind).toBe("go");
    expect(deriveProjectCard(["Cargo.toml"]).kind).toBe("rust");
  });

  it("falls back to npm when there is no lockfile", () => {
    expect(deriveProjectCard(["package.json"]).suggestedCommands).toContain("npm test");
  });

  it("returns unknown for an unrecognized project", () => {
    const card = deriveProjectCard(["README.md", "notes.txt"]);
    expect(card.kind).toBe("unknown");
    expect(card.suggestedCommands).toEqual([]);
  });

  it("counts top extensions by frequency", () => {
    const card = deriveProjectCard(["a.ts", "b.ts", "c.ts", "d.js", "Makefile"]);
    expect(card.topExtensions[0]).toEqual({ ext: ".ts", count: 3 });
    expect(card.topExtensions.find((e) => e.ext === ".js")?.count).toBe(1);
  });
});
