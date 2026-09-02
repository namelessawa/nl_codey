/**
 * Modal inline picker for `/skills-generate`. Arrow-key navigation with
 * a leading `>` cursor; `↵` to confirm, `esc` / `q` to cancel.
 *
 * Border discipline: top + bottom rails only (single line) at phase 4 —
 * same slot as the approval card.
 */
import React from "react";
import { useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import type { SkillInstallLocation } from "../lib/skill-generator.js";

export type PendingSkill = {
  description: string;
};

export type SkillInstallPickerProps = {
  pending: PendingSkill;
  busy: boolean;
  onPick: (location: SkillInstallLocation) => void;
  onCancel: () => void;
};

type Option = {
  value: SkillInstallLocation;
  label: string;
  path: string;
};

const OPTIONS: readonly Option[] = [
  { value: "project", label: "project", path: ".nlc/skills/" },
  { value: "global", label: "global", path: "~/.nlc/skills/" },
  { value: "both", label: "both", path: "(project + global)" },
];

export function SkillInstallPicker({
  pending,
  busy,
  onPick,
  onCancel,
}: SkillInstallPickerProps) {
  const { palette, box: glyph } = useTheme();
  const border = useAnimatedBorder(4);
  const [selected, setSelected] = useState(0);

  const inputHandlerRef = useRef<(input: string, key: Key) => void>(
    () => undefined,
  );
  inputHandlerRef.current = (input, key) => {
    if (busy) return;
    if (key.escape || input.toLowerCase() === "q") {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((i) => (i - 1 + OPTIONS.length) % OPTIONS.length);
      return;
    }
    if (key.downArrow) {
      setSelected((i) => (i + 1) % OPTIONS.length);
      return;
    }
    if (key.return) {
      const choice = OPTIONS[selected];
      if (choice) onPick(choice.value);
      return;
    }
  };
  const stableInputHandler = useRef(
    (input: string, key: Key) => inputHandlerRef.current(input, key),
  ).current;
  useInput(stableInputHandler);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderColor={border}
      paddingX={1}
    >
      <Text color={palette.accent} bold>
        [skill] install target
      </Text>
      <Text color={palette.textDim}>{glyph.singleH.repeat(40)}</Text>
      <Text color={palette.text}>{`description: ${truncate(pending.description, 100)}`}</Text>
      <Box marginTop={1}>
        <Text color={palette.textDim}>where should the generated skill live?</Text>
      </Box>
      {OPTIONS.map((opt, idx) => (
        <Row key={opt.value} option={opt} active={idx === selected} busy={busy} />
      ))}
      <Box marginTop={1}>
        {busy ? (
          <Text color={palette.primaryActive}>
            generating… (calling LLM, please wait)
          </Text>
        ) : (
          <Text color={palette.textDim}>
            <Text color={palette.accent} bold>↑↓</Text> select{"   "}
            <Text color={palette.accent} bold>↵</Text> confirm{"   "}
            <Text color={palette.danger} bold>esc</Text> cancel
          </Text>
        )}
      </Box>
    </Box>
  );
}

function Row({
  option,
  active,
  busy,
}: {
  option: Option;
  active: boolean;
  busy: boolean;
}) {
  const { palette } = useTheme();
  const cursor = active ? ">" : " ";
  const cursorColor = busy
    ? palette.textDim
    : active
      ? palette.accent
      : palette.textDim;
  const labelColor = busy
    ? palette.textDim
    : active
      ? palette.primaryActive
      : palette.text;
  return (
    <Box flexDirection="row">
      <Text color={cursorColor} bold>{` ${cursor} `}</Text>
      <Text color={labelColor} bold>{option.label.padEnd(8)}</Text>
      <Text color={palette.textDim}>{option.path}</Text>
    </Box>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
