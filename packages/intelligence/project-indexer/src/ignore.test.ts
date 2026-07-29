import { describe, expect, it } from "vitest";
import { IGNORED_DIRS, isIgnoredDir } from "./ignore.js";

describe("project-indexer ignored directories", () => {
  it("recognizes every fixed ignored directory", () => {
    for (const directory of IGNORED_DIRS) {
      expect(isIgnoredDir(directory)).toBe(true);
    }
  });

  it("matches ignored names case-insensitively for Windows workspaces", () => {
    expect(isIgnoredDir("NODE_MODULES")).toBe(true);
    expect(isIgnoredDir(".GIT")).toBe(true);
    expect(isIgnoredDir("__PYCACHE__")).toBe(true);
  });

  it("does not ignore near matches or ordinary hidden directories", () => {
    expect(isIgnoredDir("node_modules_backup")).toBe(false);
    expect(isIgnoredDir(".github")).toBe(false);
    expect(isIgnoredDir("source")).toBe(false);
  });
});
