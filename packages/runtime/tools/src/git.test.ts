import { describe, expect, it } from "vitest";
import { parseGitStatus } from "./git.js";

describe("parseGitStatus", () => {
  it("extracts the branch and categorizes files", () => {
    const porcelain = [
      "## main...origin/main [ahead 1]",
      " M src/a.ts",
      "A  src/new.ts",
      " D src/gone.ts",
      "?? scratch.txt",
      "R  old.ts -> renamed.ts",
    ].join("\n");

    const status = parseGitStatus(porcelain);
    expect(status.branch).toBe("main");
    expect(status.added).toContain("src/new.ts");
    expect(status.deleted).toContain("src/gone.ts");
    expect(status.modified).toContain("src/a.ts");
    expect(status.untracked).toEqual(["scratch.txt"]);
  });

  it("handles a detached HEAD and empty output", () => {
    expect(parseGitStatus("## HEAD (no branch)").branch).toBe("HEAD");
    const empty = parseGitStatus("");
    expect(empty).toEqual({ branch: "", modified: [], added: [], deleted: [], untracked: [] });
  });
});
