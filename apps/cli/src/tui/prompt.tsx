/**
 * Bottom-of-screen prompt input with a live slash-command popup.
 *
 * Both the input box and the popup use top + bottom rails only (single
 * line) — the popup at phase 5, the input at phase 3.
 *
 * `/cmd` lines are parsed by {@link parseCommand} and routed through
 * `onCommand`; everything else becomes a task and goes to `onSubmit`.
 *
 * Input handling is intentionally defensive. Ink 5 does not expose Home/End
 * in its public Key object, so this component consumes Ink's raw input emitter
 * and delegates all editing to the pure prompt-editor state machine.
 */
import React from "react";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useStdin } from "ink";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import {
  matchCommands,
  parseCommand,
  type CommandEffect,
  type CommandSpec,
} from "./commands.js";
import {
  MAX_PROMPT_CODE_POINTS,
  consumePromptTerminalChunk,
  createPromptEditorState,
  formatPromptText,
  getPromptViewport,
  reducePromptEditor,
  submitPrompt,
  type PromptEditorAction,
  type PromptEditorState,
  type PromptInputIntent,
  type PromptTerminalDecoderState,
} from "./prompt-editor.js";

export type PromptProps = {
  disabled: boolean;
  hidden?: boolean;
  onSubmit: (task: string) => void;
  onCommand: (effect: CommandEffect) => void;
  onCancel: () => void;
};

export function Prompt({
  disabled,
  hidden = false,
  onSubmit,
  onCommand,
  onCancel,
}: PromptProps) {
  const { palette } = useTheme();
  const { internal_eventEmitter: inputEmitter, setRawMode } = useStdin();
  const inputBorder = useAnimatedBorder(3);
  const [editor, setEditor] = useState<PromptEditorState>(() =>
    createPromptEditorState(),
  );
  const editorRef = useRef(editor);
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(selected);
  const callbacksRef = useRef({ onSubmit, onCommand, onCancel });
  callbacksRef.current = { onSubmit, onCommand, onCancel };

  const suggestions = matchCommands(editor.value);
  const safeSelected =
    suggestions.length === 0 ? 0 : Math.min(selected, suggestions.length - 1);

  const replaceEditor = (next: PromptEditorState): void => {
    editorRef.current = next;
    setEditor(next);
  };

  const editEditor = (action: PromptEditorAction): void => {
    replaceEditor(reducePromptEditor(editorRef.current, action));
  };

  const select = (next: number): void => {
    selectedRef.current = next;
    setSelected(next);
  };

  useEffect(() => {
    if (disabled || hidden) return;

    let decoderState: PromptTerminalDecoderState = {
      pasteBuffer: null,
      pendingInput: "",
    };

    const handleIntent = (intent: PromptInputIntent): void => {
      const current = editorRef.current;
      const currentSuggestions = matchCommands(current.value);
      const currentSelected =
        currentSuggestions.length === 0
          ? 0
          : Math.min(selectedRef.current, currentSuggestions.length - 1);

      switch (intent.type) {
        case "edit":
          editEditor(intent.action);
          select(0);
          return;
        case "up":
          if (
            currentSuggestions.length > 0 &&
            current.historyIndex === null
          ) {
            select(
              (currentSelected - 1 + currentSuggestions.length) %
                currentSuggestions.length,
            );
          } else {
            editEditor({ type: "history-previous" });
            select(0);
          }
          return;
        case "down":
          if (
            currentSuggestions.length > 0 &&
            current.historyIndex === null
          ) {
            select((currentSelected + 1) % currentSuggestions.length);
          } else {
            editEditor({ type: "history-next" });
            select(0);
          }
          return;
        case "tab": {
          if (currentSuggestions.length === 0) return;
          if (intent.reverse) {
            select(
              (currentSelected - 1 + currentSuggestions.length) %
                currentSuggestions.length,
            );
            return;
          }
          const choice = currentSuggestions[currentSelected];
          if (choice) {
            const completed = choice.name.split(/\s+/)[0]!;
            const takesArg = choice.name.includes("<");
            editEditor({
              type: "replace",
              text: takesArg ? `${completed} ` : completed,
            });
            select(0);
          }
          return;
        }
        case "escape":
          editEditor({ type: "clear" });
          select(0);
          return;
        case "interrupt":
          if (current.value.length > 0) {
            editEditor({ type: "clear" });
            select(0);
          } else {
            callbacksRef.current.onCancel();
          }
          return;
        case "submit": {
          // Update the ref before invoking callbacks. A second Enter delivered
          // in the same React batch therefore sees an empty line.
          const submitted = submitPrompt(current);
          replaceEditor(submitted.state);
          select(0);
          if (!submitted.line.trim()) return;
          const command = parseCommand(submitted.line);
          if (command) callbacksRef.current.onCommand(command);
          else callbacksRef.current.onSubmit(submitted.line);
          return;
        }
        case "page-up":
        case "page-down":
          // Scrollback belongs to the terminal. Recognize these sequences so
          // they cannot leak into or mutate the draft, but do not emulate a
          // viewport inside Ink.
          return;
        case "ignore":
          return;
      }
    };

    const handleData = (data: string | Buffer): void => {
      const decoded = consumePromptTerminalChunk(
        decoderState,
        Buffer.isBuffer(data) ? data.toString("utf8") : String(data),
      );
      decoderState = decoded.state;
      for (const intent of decoded.intents) handleIntent(intent);
    };

    setRawMode(true);
    inputEmitter.on("input", handleData);
    return () => {
      inputEmitter.removeListener("input", handleData);
      setRawMode(false);
    };
  }, [disabled, hidden, inputEmitter, setRawMode]);

  const viewport = getPromptViewport(editor);
  const beforeCursor = `${viewport.clippedStart ? "…" : ""}${formatPromptText(
    viewport.beforeCursor,
  )}`;
  const afterCursor = `${formatPromptText(viewport.afterCursor)}${
    viewport.clippedEnd ? "…" : ""
  }`;
  const atLimit = Array.from(editor.value).length >= MAX_PROMPT_CODE_POINTS;

  if (hidden) return null;

  const prefix = disabled ? "…" : "❯";
  const prefixColor = disabled ? palette.textDim : palette.accent;

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 ? (
        <CommandPopup
          items={suggestions}
          selected={safeSelected}
          query={editor.value}
        />
      ) : null}
      <Box
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={disabled ? palette.textDim : inputBorder}
        paddingX={1}
      >
        <Text color={prefixColor} bold>
          {prefix}
        </Text>
        <Text color={palette.text}>{` ${beforeCursor}`}</Text>
        {!disabled ? <Text color={palette.primaryActive}>▍</Text> : null}
        <Text color={palette.text}>{afterCursor}</Text>
        {atLimit ? (
          <Text color={palette.warn}>
            {` [${MAX_PROMPT_CODE_POINTS} limit]`}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function CommandPopup({
  items,
  selected,
  query,
}: {
  items: readonly CommandSpec[];
  selected: number;
  query: string;
}) {
  const { palette } = useTheme();
  const popupBorder = useAnimatedBorder(5);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderColor={popupBorder}
      paddingX={1}
    >
      <Box>
        <Text color={palette.accent} bold>
          {`command palette `}
        </Text>
        <Text color={palette.textDim}>{`(${items.length} match${items.length === 1 ? "" : "es"}, q="${query}")`}</Text>
      </Box>
      {items.map((cmd, idx) => (
        <PopupRow key={cmd.name} cmd={cmd} active={idx === selected} />
      ))}
      <Text color={palette.textDim}>
        {`↑↓ select   ⇥ complete   ↵ run   esc clear`}
      </Text>
    </Box>
  );
}

function PopupRow({ cmd, active }: { cmd: CommandSpec; active: boolean }) {
  const { palette } = useTheme();
  const arrow = active ? "▸" : " ";
  const nameColor = active ? palette.primaryActive : palette.text;
  const arrowColor = active ? palette.accent : palette.textDim;
  return (
    <Box flexDirection="row">
      <Text color={arrowColor}>{arrow}</Text>
      <Text color={nameColor} bold>{` ${cmd.name.padEnd(24)}`}</Text>
      <Text color={palette.textDim}>{cmd.hint}</Text>
    </Box>
  );
}
