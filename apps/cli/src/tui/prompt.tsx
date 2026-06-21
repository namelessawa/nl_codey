/**
 * Bottom-of-screen prompt input with a live slash-command popup.
 *
 * Both the input box and the popup use top + bottom rails only (single
 * line) — the popup at phase 5, the input at phase 3.
 *
 * `/cmd` lines are parsed by {@link parseCommand} and routed through
 * `onCommand`; everything else becomes a task and goes to `onSubmit`.
 *
 * Input handling is intentionally defensive: Windows terminals are
 * inconsistent about backspace (PowerShell + Windows Terminal can send
 * `\x7f`, plain cmd.exe `\x08`, and conhost sometimes wraps both with
 * ESC). We accept all three plus Ink's parsed `key.backspace`/
 * `key.delete`, and we evaluate the erase branch BEFORE the
 * suggestions block — so the popup never swallows a backspace.
 */
import React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import {
  matchCommands,
  parseCommand,
  type CommandEffect,
  type CommandSpec,
} from "./commands.js";

export type PromptProps = {
  disabled: boolean;
  onSubmit: (task: string) => void;
  onCommand: (effect: CommandEffect) => void;
};

/** ASCII DEL (\x7f) — Win Terminal / macOS Terminal backspace. */
const DEL = "\u007f";
/** ASCII BS (\x08) — classic cmd.exe / Ctrl-H. */
const BS = "\u0008";

function isErase(input: string, key: { backspace: boolean; delete: boolean; ctrl: boolean }): boolean {
  if (key.backspace || key.delete) return true;
  if (input === DEL || input === BS) return true;
  // Some terminals leak the raw byte INTO `input` even though Ink also
  // sets key.delete. Belt and braces:
  if (key.ctrl && input === "h") return true;
  return false;
}

export function Prompt({ disabled, onSubmit, onCommand }: PromptProps) {
  const { palette } = useTheme();
  const inputBorder = useAnimatedBorder(3);
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState(0);

  const suggestions = matchCommands(value);
  const safeSelected =
    suggestions.length === 0 ? 0 : Math.min(selected, suggestions.length - 1);

  useInput((input, key) => {
    if (disabled) return;

    // Erase first — popup must not eat a backspace.
    if (isErase(input, key)) {
      setValue((v) => v.slice(0, -1));
      setSelected(0);
      return;
    }

    // Word-erase (Ctrl+W) — handy for clearing a half-typed command.
    if (key.ctrl && input === "w") {
      setValue((v) => v.replace(/\S+\s*$/, ""));
      setSelected(0);
      return;
    }

    // Clear-line (Ctrl+U).
    if (key.ctrl && input === "u") {
      setValue("");
      setSelected(0);
      return;
    }

    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelected((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (key.downArrow) {
        setSelected((i) => (i + 1) % suggestions.length);
        return;
      }
      if (key.tab) {
        const choice = suggestions[safeSelected];
        if (choice) {
          const completed = choice.name.split(/\s+/)[0]!;
          const takesArg = choice.name.includes("<");
          setValue(takesArg ? `${completed} ` : completed);
          setSelected(0);
        }
        return;
      }
      if (key.escape) {
        setValue("");
        setSelected(0);
        return;
      }
    }
    if (key.return) {
      const line = value;
      setValue("");
      setSelected(0);
      if (!line.trim()) return;
      const cmd = parseCommand(line);
      if (cmd) onCommand(cmd);
      else onSubmit(line);
      return;
    }
    if (key.ctrl && input === "c") {
      setValue("");
      setSelected(0);
      return;
    }
    // Printable input — reject stray control bytes and meta-escapes.
    if (input && !key.meta && !key.ctrl && input !== DEL && input !== BS) {
      setValue((v) => v + input);
      setSelected(0);
    }
  });

  const prefix = disabled ? "…" : "❯";
  const prefixColor = disabled ? palette.textDim : palette.accent;

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 ? (
        <CommandPopup
          items={suggestions}
          selected={safeSelected}
          query={value}
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
        <Text color={palette.text}>{` ${value}`}</Text>
        {!disabled ? <Text color={palette.primaryActive}>▍</Text> : null}
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
