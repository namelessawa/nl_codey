import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "./store.js";

let tmp: string;
let store: SessionStore;
let clock = 1_700_000_000_000;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-session-"));
  clock = 1_700_000_000_000;
  store = new SessionStore({ root: tmp, now: () => clock });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("creates a session file with a header line and an empty body", () => {
    const writer = store.createSession("E:\\proj\\foo");
    expect(fs.existsSync(writer.filePath)).toBe(true);
    const raw = fs.readFileSync(writer.filePath, "utf8");
    const lines = raw.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: "session",
      version: 1,
      cwd: "E:\\proj\\foo",
      timestamp: clock,
    });
  });

  it("appends messages with a parent-pointer chain", () => {
    const writer = store.createSession("E:\\proj\\foo");
    clock += 1000;
    const a = writer.appendMessage({ role: "user", content: "hello" });
    clock += 1000;
    const b = writer.appendMessage({ role: "assistant", content: "hi" });
    clock += 1000;
    const c = writer.appendMessage({
      role: "tool",
      toolCallId: "call_1",
      content: "result",
    });

    expect(a.parentId).toBeNull();
    expect(b.parentId).toBe(a.id);
    expect(c.parentId).toBe(b.id);
    expect(c.toolCallId).toBe("call_1");

    const loaded = store.openSession(writer.filePath);
    expect(loaded.messages.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it("redacts system errors before JSONL persistence without rewriting user prose", () => {
    const writer = store.createSession("E:\\proj\\foo");
    const secret =
      "error: Authorization: Bearer jsonl-secret\nat C:\\Users\\alice\\.npmrc";
    const system = writer.appendMessage({ role: "system", content: secret });
    const userText = "please explain token=example without treating this prose as an error";
    const user = writer.appendMessage({ role: "user", content: userText });
    const raw = fs.readFileSync(writer.filePath, "utf8");

    expect(system.content).toContain("[REDACTED]");
    expect(system.content).toContain("[USER_HOME]");
    expect(system.content).not.toMatch(/jsonl-secret|alice/);
    expect(user.content).toBe(userText);
    expect(raw).not.toContain("jsonl-secret");
    expect(store.openSession(writer.filePath).messages[1]!.content).toBe(userText);
  });

  it("appends state events without disturbing the message chain", () => {
    const writer = store.createSession("E:\\proj\\foo");
    const a = writer.appendMessage({ role: "user", content: "hi" });
    writer.appendStateEvent({
      type: "model_change",
      from: { provider: "openai", model: "gpt-4" },
      to: { provider: "anthropic", model: "claude-opus-4-7" },
    });
    const b = writer.appendMessage({ role: "assistant", content: "ok" });
    expect(b.parentId).toBe(a.id);

    const loaded = store.openSession(writer.filePath);
    expect(loaded.events).toHaveLength(1);
    expect(loaded.events[0]!.type).toBe("model_change");
    expect(loaded.messages).toHaveLength(2);
  });

  it("survives a truncated trailing line on read", () => {
    const writer = store.createSession("E:\\proj\\foo");
    writer.appendMessage({ role: "user", content: "hello" });
    // Simulate a partial write at the tail.
    fs.appendFileSync(writer.filePath, '{"type":"message","id":"msg_x"', "utf8");
    const loaded = store.openSession(writer.filePath);
    expect(loaded.messages).toHaveLength(1);
  });

  it("skips unknown record types (forward-compat)", () => {
    const writer = store.createSession("E:\\proj\\foo");
    fs.appendFileSync(
      writer.filePath,
      JSON.stringify({ type: "future_event", whatever: true }) + "\n",
      "utf8",
    );
    writer.appendMessage({ role: "user", content: "hello" });
    const loaded = store.openSession(writer.filePath);
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.events).toHaveLength(0);
  });

  it("lists sessions in a project newest-first with derived titles", () => {
    const cwd = "E:\\proj\\foo";
    const w1 = store.createSession(cwd);
    w1.appendMessage({ role: "user", content: "first task" });
    clock += 60_000;
    const w2 = store.createSession(cwd);
    w2.appendMessage({ role: "user", content: "second task" });

    const list = store.listProjectSessions(cwd);
    expect(list.map((s) => s.id)).toEqual([w2.header.id, w1.header.id]);
    expect(list[0]!.title).toBe("second task");
    expect(list[1]!.title).toBe("first task");
    expect(list[0]!.messageCount).toBe(1);
  });

  it("branches a new session that anchors its first message to the parent", () => {
    const cwd = "E:\\proj\\foo";
    const w1 = store.createSession(cwd);
    const m1 = w1.appendMessage({ role: "user", content: "hi" });
    const m2 = w1.appendMessage({ role: "assistant", content: "hi there" });

    clock += 1000;
    const w2 = store.branchSession({
      sessionId: w1.header.id,
      messageId: m1.id,
      cwd,
    });
    const newRoot = w2.appendMessage({ role: "user", content: "try a different angle" });

    expect(w2.header.parent).toEqual({ sessionId: w1.header.id, messageId: m1.id });
    expect(newRoot.parentId).toBe(m1.id);
    // The original session is untouched.
    const loadedOriginal = store.openSession(w1.filePath);
    expect(loadedOriginal.messages.map((m) => m.id)).toEqual([m1.id, m2.id]);
  });

  it("throws when branching from an unknown message", () => {
    const cwd = "E:\\proj\\foo";
    const w1 = store.createSession(cwd);
    expect(() =>
      store.branchSession({ sessionId: w1.header.id, messageId: "msg_nope", cwd }),
    ).toThrow(/not found/);
  });

  it("resumes appending to an existing file with the chain head primed", () => {
    const cwd = "E:\\proj\\foo";
    const w1 = store.createSession(cwd);
    const m1 = w1.appendMessage({ role: "user", content: "hi" });
    const m2 = w1.appendMessage({ role: "assistant", content: "yo" });

    const { writer: w1b } = store.resumeSession(w1.filePath);
    expect(w1b.lastMessageId).toBe(m2.id);
    const m3 = w1b.appendMessage({ role: "user", content: "again" });
    expect(m3.parentId).toBe(m2.id);

    const loaded = store.openSession(w1.filePath);
    expect(loaded.messages.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
  });

  it("returns an empty list for projects that have no folder yet", () => {
    expect(store.listProjectSessions("E:\\nothing\\here")).toEqual([]);
  });

  it("refuses to append after close()", () => {
    const w = store.createSession("E:\\proj\\foo");
    w.close();
    expect(() => w.appendMessage({ role: "user", content: "x" })).toThrow(/closed/);
  });
});
