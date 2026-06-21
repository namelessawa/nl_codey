import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";
import { buildProjectTree, renderProjectTree } from "./tree.js";

let tmp: string;
let store: SessionStore;
let clock = 1_700_000_000_000;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-tree-"));
  clock = 1_700_000_000_000;
  store = new SessionStore({ root: tmp, now: () => clock });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("buildProjectTree", () => {
  it("returns no rows for an empty project", () => {
    const rows = buildProjectTree(store.loadProjectSessions("E:\\proj\\empty"));
    expect(rows).toEqual([]);
  });

  it("places a linear conversation in a single lane", () => {
    const cwd = "E:\\proj\\foo";
    const w = store.createSession(cwd);
    clock += 1000;
    const m1 = w.appendMessage({ role: "user", content: "hi" });
    clock += 1000;
    const m2 = w.appendMessage({ role: "assistant", content: "yo" });
    clock += 1000;
    const m3 = w.appendMessage({ role: "user", content: "more" });

    const loaded = store.loadProjectSessions(cwd);
    const rows = buildProjectTree(loaded);
    expect(rows.map((r) => r.kind)).toEqual(["node", "node", "node"]);
    // Newest first
    expect((rows[0]!.kind === "node" ? rows[0]!.message.id : "")).toBe(m3.id);
    expect((rows[2]!.kind === "node" ? rows[2]!.message.id : "")).toBe(m1.id);
    // All in lane 0
    expect(rows.every((r) => r.kind !== "node" || r.lane === 0)).toBe(true);
  });

  it("draws two columns and merges down at the branch point", () => {
    const cwd = "E:\\proj\\foo";
    const w1 = store.createSession(cwd);
    clock += 1000;
    const m1 = w1.appendMessage({ role: "user", content: "task" });
    clock += 1000;
    w1.appendMessage({ role: "assistant", content: "approach A" });
    clock += 1000;
    const w2 = store.branchSession({ sessionId: w1.header.id, messageId: m1.id, cwd });
    clock += 1000;
    w2.appendMessage({ role: "assistant", content: "approach B" });

    const rows = buildProjectTree(store.loadProjectSessions(cwd));
    // 1 root + 2 children + 1 merge row = 4 rows
    expect(rows).toHaveLength(4);
    // The merge row must reference the branch point (m1) directly above
    // and use `|/` style ascii.
    const merge = rows.find((r) => r.kind === "merge");
    expect(merge).toBeTruthy();
    expect(merge!.ascii).toMatch(/\//);
  });

  it("treats orphan parentIds as roots rather than crashing", () => {
    const cwd = "E:\\proj\\foo";
    const w = store.createSession(cwd);
    // Use a parent id that won't exist.
    w.appendMessage({ role: "user", content: "orphan", parentId: "msg_unknown" });
    const rows = buildProjectTree(store.loadProjectSessions(cwd));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("node");
  });
});

describe("renderProjectTree", () => {
  it("renders a header block and a body, with no exception on empty projects", () => {
    const cwd = "E:\\proj\\empty";
    const out = renderProjectTree(store.loadProjectSessions(cwd), store.listProjectSessions(cwd));
    expect(out).toContain("sessions");
  });

  it("highlights the active session with a `>` marker and `*` suffix on its id", () => {
    const cwd = "E:\\proj\\foo";
    const w = store.createSession(cwd);
    w.appendMessage({ role: "user", content: "hello" });
    const out = renderProjectTree(
      store.loadProjectSessions(cwd),
      store.listProjectSessions(cwd),
      { activeSessionId: w.header.id },
    );
    expect(out).toContain(`> ${w.header.id}`);
    expect(out).toContain(`${w.header.id}*`);
  });
});
