/**
 * Pure, terminal-independent prompt editing.
 *
 * Cursor positions are Unicode code-point offsets rather than UTF-16 offsets,
 * so editing CJK and astral characters never leaves a dangling surrogate.
 * The terminal decoder below is deliberately small and explicit: it accepts
 * the Windows/ANSI sequences the product contract promises and ignores
 * unknown escape/control sequences instead of echoing them into the prompt.
 */

export const MAX_PROMPT_CODE_POINTS = 16_384;
export const MAX_PROMPT_HISTORY = 50;
export const MAX_PROMPT_RENDER_CODE_POINTS = 240;

export type PromptEditorState = {
  value: string;
  cursor: number;
  history: readonly string[];
  historyIndex: number | null;
  historyDraft: string | null;
};

export type PromptEditorAction =
  | { type: "insert"; text: string }
  | { type: "replace"; text: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "delete-word" }
  | { type: "clear" }
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "history-previous" }
  | { type: "history-next" };

export type PromptInputIntent =
  | { type: "edit"; action: PromptEditorAction }
  | { type: "submit" }
  | { type: "tab"; reverse: boolean }
  | { type: "escape" }
  | { type: "interrupt" }
  | { type: "up" }
  | { type: "down" }
  | { type: "ignore" };

export type PromptTerminalDecoderState = {
  pasteBuffer: string | null;
  pendingInput: string;
};

export type PromptTerminalDecodeResult = {
  state: PromptTerminalDecoderState;
  intents: readonly PromptInputIntent[];
};

export type PromptViewport = {
  beforeCursor: string;
  afterCursor: string;
  clippedStart: boolean;
  clippedEnd: boolean;
};

const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
const MAX_PASTE_BUFFER_CODE_UNITS = MAX_PROMPT_CODE_POINTS * 4;

function boundPasteBuffer(value: string): string {
  if (value.length <= MAX_PASTE_BUFFER_CODE_UNITS) return value;
  const tailLength = BRACKETED_PASTE_END.length - 1;
  return (
    value.slice(0, MAX_PASTE_BUFFER_CODE_UNITS - tailLength) +
    value.slice(-tailLength)
  );
}

const HOME_SEQUENCES = new Set([
  "\u001b[H",
  "\u001bOH",
  "\u001b[1~",
  "\u001b[7~",
]);
const END_SEQUENCES = new Set([
  "\u001b[F",
  "\u001bOF",
  "\u001b[4~",
  "\u001b[8~",
]);
const LEFT_SEQUENCES = new Set(["\u001b[D", "\u001bOD"]);
const RIGHT_SEQUENCES = new Set(["\u001b[C", "\u001bOC"]);
const UP_SEQUENCES = new Set(["\u001b[A", "\u001bOA"]);
const DOWN_SEQUENCES = new Set(["\u001b[B", "\u001bOB"]);
const DELETE_SEQUENCES = new Set(["\u001b[3~"]);
const CTRL_ENTER_SEQUENCES = new Set([
  "\u001b[13;5u",
  "\u001b[27;5;13~",
]);
const TERMINAL_KEY_SEQUENCES = [
  ...CTRL_ENTER_SEQUENCES,
  ...HOME_SEQUENCES,
  ...END_SEQUENCES,
  ...LEFT_SEQUENCES,
  ...RIGHT_SEQUENCES,
  ...UP_SEQUENCES,
  ...DOWN_SEQUENCES,
  ...DELETE_SEQUENCES,
  "\u001b[Z",
  "\u001b\b",
  "\r",
  "\n",
  "\t",
  "\u0003",
  "\u0017",
  "\u0015",
  "\b",
  "\u007f",
].sort((left, right) => right.length - left.length);

function codePoints(value: string): string[] {
  return Array.from(value);
}

function withDetachedHistory(
  state: PromptEditorState,
  next: Pick<PromptEditorState, "value" | "cursor">,
): PromptEditorState {
  return {
    ...state,
    ...next,
    historyIndex: null,
    historyDraft: null,
  };
}

export function createPromptEditorState(
  initialValue = "",
  history: readonly string[] = [],
): PromptEditorState {
  const value = truncatePromptText(sanitizePromptText(initialValue));
  const boundedHistory = history
    .filter((entry) => entry.trim().length > 0)
    .slice(-MAX_PROMPT_HISTORY);
  return {
    value,
    cursor: codePoints(value).length,
    history: boundedHistory,
    historyIndex: null,
    historyDraft: null,
  };
}

export function sanitizePromptText(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  return codePoints(normalized)
    .filter((character) => {
      if (character === "\n" || character === "\t") return true;
      const point = character.codePointAt(0) ?? 0;
      return (
        point >= 0x20 &&
        point !== 0x7f &&
        !(point >= 0x80 && point <= 0x9f)
      );
    })
    .join("");
}

export function truncatePromptText(value: string): string {
  return codePoints(value).slice(0, MAX_PROMPT_CODE_POINTS).join("");
}

export function reducePromptEditor(
  state: PromptEditorState,
  action: PromptEditorAction,
): PromptEditorState {
  const current = codePoints(state.value);
  const cursor = Math.max(0, Math.min(state.cursor, current.length));

  switch (action.type) {
    case "insert": {
      const inserted = codePoints(sanitizePromptText(action.text));
      const available = Math.max(0, MAX_PROMPT_CODE_POINTS - current.length);
      const accepted = inserted.slice(0, available);
      if (accepted.length === 0) return state;
      const value = [
        ...current.slice(0, cursor),
        ...accepted,
        ...current.slice(cursor),
      ].join("");
      return withDetachedHistory(state, {
        value,
        cursor: cursor + accepted.length,
      });
    }
    case "replace": {
      const value = truncatePromptText(sanitizePromptText(action.text));
      return withDetachedHistory(state, {
        value,
        cursor: codePoints(value).length,
      });
    }
    case "backspace": {
      if (cursor === 0) return state;
      current.splice(cursor - 1, 1);
      return withDetachedHistory(state, {
        value: current.join(""),
        cursor: cursor - 1,
      });
    }
    case "delete": {
      if (cursor >= current.length) return state;
      current.splice(cursor, 1);
      return withDetachedHistory(state, {
        value: current.join(""),
        cursor,
      });
    }
    case "delete-word": {
      let start = cursor;
      while (start > 0 && /\s/u.test(current[start - 1] ?? "")) start -= 1;
      while (start > 0 && !/\s/u.test(current[start - 1] ?? "")) start -= 1;
      if (start === cursor) return state;
      current.splice(start, cursor - start);
      return withDetachedHistory(state, {
        value: current.join(""),
        cursor: start,
      });
    }
    case "clear":
      return withDetachedHistory(state, { value: "", cursor: 0 });
    case "left":
      return { ...state, cursor: Math.max(0, cursor - 1) };
    case "right":
      return { ...state, cursor: Math.min(current.length, cursor + 1) };
    case "home":
      return { ...state, cursor: 0 };
    case "end":
      return { ...state, cursor: current.length };
    case "history-previous": {
      if (state.history.length === 0) return state;
      const historyIndex =
        state.historyIndex === null
          ? state.history.length - 1
          : Math.max(0, state.historyIndex - 1);
      const value = state.history[historyIndex] ?? "";
      return {
        ...state,
        value,
        cursor: codePoints(value).length,
        historyIndex,
        historyDraft:
          state.historyIndex === null ? state.value : state.historyDraft,
      };
    }
    case "history-next": {
      if (state.historyIndex === null) return state;
      if (state.historyIndex < state.history.length - 1) {
        const historyIndex = state.historyIndex + 1;
        const value = state.history[historyIndex] ?? "";
        return {
          ...state,
          value,
          cursor: codePoints(value).length,
          historyIndex,
        };
      }
      const value = state.historyDraft ?? "";
      return {
        ...state,
        value,
        cursor: codePoints(value).length,
        historyIndex: null,
        historyDraft: null,
      };
    }
  }
}

export function submitPrompt(state: PromptEditorState): {
  line: string;
  state: PromptEditorState;
} {
  const line = state.value;
  const history =
    line.trim().length === 0 ||
    state.history[state.history.length - 1] === line
      ? state.history
      : [...state.history, line].slice(-MAX_PROMPT_HISTORY);
  return {
    line,
    state: {
      value: "",
      cursor: 0,
      history,
      historyIndex: null,
      historyDraft: null,
    },
  };
}

export function getPromptViewport(
  state: PromptEditorState,
  limit = MAX_PROMPT_RENDER_CODE_POINTS,
): PromptViewport {
  const current = codePoints(state.value);
  const safeLimit = Math.max(1, limit);
  const cursor = Math.max(0, Math.min(state.cursor, current.length));
  const initialStart = Math.max(0, cursor - Math.floor(safeLimit / 2));
  const end = Math.min(current.length, initialStart + safeLimit);
  const start = Math.max(0, end - safeLimit);
  return {
    beforeCursor: current.slice(start, cursor).join(""),
    afterCursor: current.slice(cursor, end).join(""),
    clippedStart: start > 0,
    clippedEnd: end < current.length,
  };
}

export function formatPromptText(value: string): string {
  return value.replaceAll("\n", "↵").replaceAll("\t", "⇥");
}

function edit(action: PromptEditorAction): PromptInputIntent {
  return { type: "edit", action };
}

export function decodePromptInput(value: string): PromptInputIntent {
  if (value === "\r" || value === "\n") return { type: "submit" };
  if (value === "\t") return { type: "tab", reverse: false };
  if (value === "\u001b[Z") return { type: "tab", reverse: true };
  if (value === "\u001b") return { type: "escape" };
  if (value === "\u0003") return { type: "interrupt" };
  if (value === "\u0017") return edit({ type: "delete-word" });
  if (value === "\u0015") return edit({ type: "clear" });
  if (value === "\b" || value === "\u007f" || value === "\u001b\b") {
    return edit({ type: "backspace" });
  }
  if (HOME_SEQUENCES.has(value)) return edit({ type: "home" });
  if (END_SEQUENCES.has(value)) return edit({ type: "end" });
  if (LEFT_SEQUENCES.has(value)) return edit({ type: "left" });
  if (RIGHT_SEQUENCES.has(value)) return edit({ type: "right" });
  if (UP_SEQUENCES.has(value)) return { type: "up" };
  if (DOWN_SEQUENCES.has(value)) return { type: "down" };
  if (DELETE_SEQUENCES.has(value)) return edit({ type: "delete" });
  if (CTRL_ENTER_SEQUENCES.has(value)) return edit({ type: "insert", text: "\n" });
  if (value.startsWith("\u001b")) return { type: "ignore" };

  const text = sanitizePromptText(value);
  return text.length > 0 ? edit({ type: "insert", text }) : { type: "ignore" };
}

function decodeNonPasteChunk(chunk: string): {
  intents: PromptInputIntent[];
  pendingInput: string;
} {
  const intents: PromptInputIntent[] = [];
  let offset = 0;

  while (offset < chunk.length) {
    const remaining = chunk.slice(offset);
    const sequence = TERMINAL_KEY_SEQUENCES.find((candidate) =>
      remaining.startsWith(candidate),
    );
    if (sequence) {
      intents.push(decodePromptInput(sequence));
      offset += sequence.length;
      continue;
    }

    if (remaining === "\u001b") {
      intents.push({ type: "escape" });
      offset += 1;
      continue;
    }

    if (remaining.startsWith("\u001b")) {
      const isPartialKnownSequence = [
        BRACKETED_PASTE_START,
        ...TERMINAL_KEY_SEQUENCES,
      ].some(
        (candidate) =>
          candidate.length > remaining.length &&
          candidate.startsWith(remaining),
      );
      const isPartialGenericSequence =
        /^\u001b(?:\[[0-?]*[ -/]*)?$/u.test(remaining) ||
        remaining === "\u001bO";
      if (isPartialKnownSequence || isPartialGenericSequence) {
        return { intents, pendingInput: remaining };
      }

      // Consume an unknown CSI/SS3/meta sequence as one ignored token so its
      // printable tail can never leak into the prompt.
      const escape =
        /^\u001b(?:\[[0-?]*[ -/]*[@-~]|O.|.)/u.exec(remaining)?.[0] ??
        "\u001b";
      intents.push({ type: "ignore" });
      offset += escape.length;
      continue;
    }

    let end = offset;
    while (end < chunk.length) {
      const point = chunk.codePointAt(end) ?? 0;
      if (point < 0x20 || point === 0x7f) break;
      end += point > 0xffff ? 2 : 1;
    }
    if (end === offset) {
      intents.push({ type: "ignore" });
      offset += 1;
      continue;
    }
    intents.push(decodePromptInput(chunk.slice(offset, end)));
    offset = end;
  }

  return { intents, pendingInput: "" };
}

/**
 * Consume one raw terminal chunk, including bracketed-paste markers that may
 * be split across several chunks. Paste buffering is bounded before the
 * editor's independent code-point bound is applied.
 */
export function consumePromptTerminalChunk(
  state: PromptTerminalDecoderState,
  chunk: string,
): PromptTerminalDecodeResult {
  const intents: PromptInputIntent[] = [];
  let pasteBuffer = state.pasteBuffer;
  let pendingInput = "";
  let remaining = state.pendingInput + chunk;

  while (remaining.length > 0) {
    if (pasteBuffer !== null) {
      const combined = pasteBuffer + remaining;
      const end = combined.indexOf(BRACKETED_PASTE_END);
      if (end < 0) {
        pasteBuffer = boundPasteBuffer(combined);
        remaining = "";
        break;
      }
      const text = sanitizePromptText(
        combined.slice(0, end).slice(0, MAX_PASTE_BUFFER_CODE_UNITS),
      );
      if (text.length > 0) intents.push(edit({ type: "insert", text }));
      pasteBuffer = null;
      remaining = combined.slice(end + BRACKETED_PASTE_END.length);
      continue;
    }

    const start = remaining.indexOf(BRACKETED_PASTE_START);
    if (start >= 0) {
      if (start > 0) {
        const decoded = decodeNonPasteChunk(remaining.slice(0, start));
        intents.push(...decoded.intents);
        pendingInput = decoded.pendingInput;
      }
      pasteBuffer = "";
      remaining = remaining.slice(start + BRACKETED_PASTE_START.length);
      continue;
    }

    const decoded = decodeNonPasteChunk(remaining);
    intents.push(...decoded.intents);
    pendingInput = decoded.pendingInput.slice(0, MAX_PASTE_BUFFER_CODE_UNITS);
    remaining = "";
  }

  return {
    state: { pasteBuffer, pendingInput },
    intents,
  };
}
