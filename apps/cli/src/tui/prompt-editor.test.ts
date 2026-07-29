import { describe, expect, it } from "vitest";
import {
  MAX_PROMPT_CODE_POINTS,
  consumePromptTerminalChunk,
  createPromptEditorState,
  decodePromptInput,
  formatPromptText,
  getPromptViewport,
  reducePromptEditor,
  sanitizePromptText,
  submitPrompt,
  type PromptEditorAction,
  type PromptEditorState,
} from "./prompt-editor.js";

function edit(
  state: PromptEditorState,
  ...actions: PromptEditorAction[]
): PromptEditorState {
  return actions.reduce(reducePromptEditor, state);
}

describe("[tui] prompt editor state machine", () => {
  it("edits CJK and astral characters by code point at the cursor", () => {
    const state = edit(
      createPromptEditorState("中🙂文"),
      { type: "left" },
      { type: "backspace" },
      { type: "insert", text: "国" },
      { type: "home" },
      { type: "delete" },
      { type: "end" },
      { type: "insert", text: "!" },
    );

    expect(state).toMatchObject({ value: "国文!", cursor: 3 });
  });

  it("deletes the prior word without disturbing text after the cursor", () => {
    const state = edit(
      createPromptEditorState("alpha beta tail"),
      { type: "left" },
      { type: "left" },
      { type: "left" },
      { type: "left" },
      { type: "delete-word" },
    );

    expect(state.value).toBe("alpha tail");
    expect(state.cursor).toBe(6);
  });

  it("recalls history, restores the draft, and collapses consecutive duplicates", () => {
    let state = createPromptEditorState("first");
    state = submitPrompt(state).state;
    state = reducePromptEditor(state, { type: "replace", text: "second" });
    state = submitPrompt(state).state;
    state = reducePromptEditor(state, { type: "replace", text: "draft" });
    state = edit(
      state,
      { type: "history-previous" },
      { type: "history-previous" },
      { type: "history-next" },
      { type: "history-next" },
    );

    expect(state.value).toBe("draft");
    expect(state.history).toEqual(["first", "second"]);

    const duplicate = submitPrompt(
      reducePromptEditor(state, { type: "replace", text: "second" }),
    ).state;
    expect(duplicate.history).toEqual(["first", "second"]);
  });

  it("normalizes multiline paste, filters controls, and bounds large input", () => {
    const raw = `第一行\r\n第\t二行\u0000\u001b\u0085${"x".repeat(
      MAX_PROMPT_CODE_POINTS + 100,
    )}`;
    const state = reducePromptEditor(createPromptEditorState(), {
      type: "insert",
      text: raw,
    });

    expect(state.value).toContain("第一行\n第\t二行");
    expect(state.value).not.toContain("\u0000");
    expect(state.value).not.toContain("\u001b");
    expect(Array.from(state.value)).toHaveLength(MAX_PROMPT_CODE_POINTS);
  });

  it("decodes Windows and ANSI editing keys without echoing unknown escapes", () => {
    expect(decodePromptInput("\u007f")).toEqual({
      type: "edit",
      action: { type: "backspace" },
    });
    expect(decodePromptInput("\u001b[3~")).toEqual({
      type: "edit",
      action: { type: "delete" },
    });
    expect(decodePromptInput("\u001b[H")).toEqual({
      type: "edit",
      action: { type: "home" },
    });
    expect(decodePromptInput("\u001b[F")).toEqual({
      type: "edit",
      action: { type: "end" },
    });
    expect(decodePromptInput("\u001b[13;5u")).toEqual({
      type: "edit",
      action: { type: "insert", text: "\n" },
    });
    expect(decodePromptInput("\u001b[Z")).toEqual({
      type: "tab",
      reverse: true,
    });
    expect(decodePromptInput("\u001b[5~")).toEqual({ type: "page-up" });
    expect(decodePromptInput("\u001b[6~")).toEqual({ type: "page-down" });
    expect(decodePromptInput("\u001b[999~")).toEqual({ type: "ignore" });
  });

  it("buffers split bracketed paste and emits one multiline insert", () => {
    const first = consumePromptTerminalChunk(
      { pasteBuffer: null, pendingInput: "" },
      "\u001b[20",
    );
    expect(first.intents).toEqual([]);
    expect(first.state.pendingInput).toBe("\u001b[20");

    const second = consumePromptTerminalChunk(
      first.state,
      "0~line one\r\n第二行\u001b[20",
    );
    expect(second.intents).toEqual([]);

    const third = consumePromptTerminalChunk(
      second.state,
      "1~",
    );
    expect(third.intents).toEqual([
      {
        type: "edit",
        action: { type: "insert", text: "line one\n第二行" },
      },
    ]);
    expect(third.state).toEqual({ pasteBuffer: null, pendingInput: "" });
  });

  it("tokenizes coalesced ConPTY editing keys in order", () => {
    const decoded = consumePromptTerminalChunk(
      { pasteBuffer: null, pendingInput: "" },
      "\u001b[H/\u001b[F\u001b[D\u001b[3~",
    );

    expect(decoded.intents).toEqual([
      { type: "edit", action: { type: "home" } },
      { type: "edit", action: { type: "insert", text: "/" } },
      { type: "edit", action: { type: "end" } },
      { type: "edit", action: { type: "left" } },
      { type: "edit", action: { type: "delete" } },
    ]);
  });

  it("recognizes coalesced and split PageUp/PageDown without text insertion", () => {
    const coalesced = consumePromptTerminalChunk(
      { pasteBuffer: null, pendingInput: "" },
      "\u001b[5~\u001b[6~",
    );
    expect(coalesced.intents).toEqual([
      { type: "page-up" },
      { type: "page-down" },
    ]);
    expect(coalesced.state.pendingInput).toBe("");

    const partial = consumePromptTerminalChunk(
      { pasteBuffer: null, pendingInput: "" },
      "\u001b[",
    );
    expect(partial.intents).toEqual([]);
    expect(partial.state.pendingInput).toBe("\u001b[");

    const completed = consumePromptTerminalChunk(partial.state, "5~");
    expect(completed.intents).toEqual([{ type: "page-up" }]);
    expect(completed.state.pendingInput).toBe("");
  });

  it("clears submitted state synchronously and ignores blank submission", () => {
    const submitted = submitPrompt(createPromptEditorState(" task "));
    expect(submitted.line).toBe(" task ");
    expect(submitted.state.value).toBe("");
    expect(submitted.state.history).toEqual([" task "]);

    const blank = submitPrompt(
      reducePromptEditor(submitted.state, { type: "insert", text: " \t " }),
    );
    expect(blank.line).toBe(" \t ");
    expect(blank.state.history).toEqual([" task "]);
  });

  it("renders a bounded single-line viewport with visible paste markers", () => {
    const value = `${"a".repeat(300)}\n\tend`;
    const state = createPromptEditorState(value);
    const viewport = getPromptViewport(state, 20);

    expect(viewport.clippedStart).toBe(true);
    expect(viewport.clippedEnd).toBe(false);
    expect(formatPromptText(viewport.beforeCursor)).toContain("↵⇥end");
    expect(sanitizePromptText("\u0001safe\u007f")).toBe("safe");
  });
});
