import { describe, it, expect } from "vitest";

import { ROLE_TOOLS, canRoleUseTool, PLANNER_PROMPT, REVIEWER_PROMPT } from "./roles.js";

describe("ROLE_TOOLS", () => {
  it("gives the planner exactly the spec'd read + propose tools", () => {
    expect(ROLE_TOOLS.planner).toEqual([
      "semantic_search",
      "find_symbol",
      "list_files",
      "read_file",
      "read_file_range",
      "propose_task_breakdown",
    ]);
  });

  it("gives the coder phase-2 tools plus the multi-agent additions", () => {
    expect(ROLE_TOOLS.coder).toContain("apply_patch");
    expect(ROLE_TOOLS.coder).toContain("request_review");
    expect(ROLE_TOOLS.coder).toContain("update_task_status");
    expect(ROLE_TOOLS.coder).toContain("web_fetch");
  });

  it("restricts the reviewer to read/inspect/verdict tools only", () => {
    expect(ROLE_TOOLS.reviewer).toEqual([
      "read_file",
      "git_diff",
      "run_command",
      "approve_change",
      "request_changes",
    ]);
  });
});

describe("canRoleUseTool", () => {
  it("allows a tool listed for the role", () => {
    expect(canRoleUseTool("coder", "apply_patch")).toBe(true);
  });

  it("denies a tool not listed for the role", () => {
    expect(canRoleUseTool("reviewer", "apply_patch")).toBe(false);
    expect(canRoleUseTool("planner", "write_file")).toBe(false);
  });
});

describe("prompt fragments", () => {
  it("planner prompt forbids writing code", () => {
    expect(PLANNER_PROMPT.toLowerCase()).toContain("do not write code");
  });

  it("reviewer prompt demands strict JSON ReviewResult", () => {
    expect(REVIEWER_PROMPT).toContain('"verdict"');
    expect(REVIEWER_PROMPT).toContain("changes_requested");
  });
});
