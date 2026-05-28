import { describe, expect, it } from "vitest";

import type { TaskNodeProposal } from "@coding-agent/shared";

import {
  detectCycles,
  globToRegExp,
  scopesOverlap,
  topoOrder,
} from "./dependency-graph.js";

function task(id: string, dependsOn: string[] = []): TaskNodeProposal {
  return { id, title: id, description: id, dependsOn };
}

describe("globToRegExp", () => {
  it("matches nested files under a double-star glob", () => {
    const re = globToRegExp("src/api/**");
    expect(re.test("src/api/x.ts")).toBe(true);
    expect(re.test("src/api/nested/y.ts")).toBe(true);
  });

  it("single star does not cross a path separator", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/index.ts")).toBe(true);
    expect(re.test("src/nested/index.ts")).toBe(false);
  });

  it("question mark matches exactly one non-separator character", () => {
    const re = globToRegExp("a?.ts");
    expect(re.test("ab.ts")).toBe(true);
    expect(re.test("abc.ts")).toBe(false);
  });
});

describe("scopesOverlap", () => {
  it("returns true for identical globs", () => {
    expect(scopesOverlap(["src/api/**"], ["src/api/**"])).toBe(true);
  });

  it("returns true when one scope is a parent directory of another", () => {
    expect(scopesOverlap(["src/**"], ["src/api/handler.ts"])).toBe(true);
  });

  it("returns false for disjoint directories", () => {
    expect(scopesOverlap(["src/api/**"], ["src/web/**"])).toBe(false);
  });

  it("returns false when either scope is empty", () => {
    expect(scopesOverlap([], ["src/api/**"])).toBe(false);
    expect(scopesOverlap(["src/api/**"], [])).toBe(false);
  });
});

describe("detectCycles", () => {
  it("returns an empty array for a DAG", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["b"])];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it("returns the ids involved in a cycle", () => {
    const tasks = [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])];
    expect(detectCycles(tasks).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores edges to unknown ids", () => {
    const tasks = [task("a", ["ghost"])];
    expect(detectCycles(tasks)).toEqual([]);
  });
});

describe("topoOrder", () => {
  it("orders dependencies before dependents", () => {
    const tasks = [task("c", ["b"]), task("b", ["a"]), task("a")];
    expect(topoOrder(tasks)).toEqual(["a", "b", "c"]);
  });

  it("throws when the graph contains a cycle", () => {
    const tasks = [task("a", ["b"]), task("b", ["a"])];
    expect(() => topoOrder(tasks)).toThrow(/cycle/i);
  });
});
