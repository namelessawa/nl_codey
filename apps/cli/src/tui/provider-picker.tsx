/**
 * Opencode-style multi-step modal for `/provider`.
 *
 * Steps:
 *
 *   1) pick    — choose a preset row or one of the 5 custom slots.
 *                 ↑↓ to move (single `>` cursor, no key chords).
 *                 Region dividers separate International / China /
 *                 Aggregator / Self-hosted / Custom. Configured rows
 *                 show a `●` marker; the active row shows `★`.
 *   2) url     — text input, pre-filled with the preset URL (or the
 *                 previously-saved one for an already-configured slot).
 *                 Editable for both presets and custom slots — vendors
 *                 sometimes ship a region-specific endpoint that
 *                 differs from the catalogue default.
 *   3) key     — text input, masked while typing. Empty submits leave
 *                 the existing key untouched on re-configuration; on
 *                 first config they signal "use env var" and warn.
 *   4) name    — text input. SKIPPED for presets (their name is locked
 *                 to the catalogue display name). For custom slots this
 *                 defaults to `Custom N` and is freely editable.
 *   5) confirm — summary row, `↵` saves, `esc` cancels.
 *
 * The modal sits in the same Ink slot as `Approval` and
 * `SkillInstallPicker` — the host component decides which one to render
 * based on its own pending-state. This component owns no global state.
 */
import React from "react";
import { useMemo, useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import {
  CUSTOM_PROVIDER_SLOT_COUNT,
  PRESET_PROVIDERS,
  customSlotKey,
  findPresetProvider,
  parseCustomSlotKey,
  type PresetProvider,
  type ProviderProtocol,
} from "@nlc/shared";
import { useAnimatedBorder, useTheme } from "./theme-context.js";
import type { StoredProvider } from "../lib/provider-store.js";

const DEL = "";
const BS = "";

const REGION_LABELS: Record<string, string> = {
  international: "International",
  china: "China",
  aggregator: "Aggregator",
  "self-hosted": "Self-hosted",
};

type Row =
  | { kind: "divider"; label: string }
  | { kind: "preset"; preset: PresetProvider }
  | { kind: "custom"; slot: number };

export type ProviderDraft = {
  key: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: ProviderProtocol;
};

export type ProviderPickerProps = {
  /** All currently-stored configs, keyed by `key`. */
  stored: Record<string, StoredProvider>;
  /** Currently active provider key, or null. */
  activeKey: string | null;
  /** Called once the user has filled every step and confirmed. */
  onSubmit: (draft: ProviderDraft) => void;
  /** User backed out at any step. */
  onCancel: () => void;
};

type Step = "pick" | "url" | "key" | "name" | "confirm";

const WINDOW = 10;

export function ProviderPicker(props: ProviderPickerProps) {
  const { palette, box: glyph } = useTheme();
  const border = useAnimatedBorder(6);

  const rows = useMemo(() => buildRows(), []);
  const firstSelectable = rows.findIndex((r) => r.kind !== "divider");
  const [cursor, setCursor] = useState(firstSelectable < 0 ? 0 : firstSelectable);
  const [step, setStep] = useState<Step>("pick");

  // Draft state — initialised lazily once the user picks a row.
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  // Input buffers for URL / Key / Name screens.
  const [buffer, setBuffer] = useState("");

  const inputHandlerRef = useRef<(input: string, key: Key) => void>(
    () => undefined,
  );
  inputHandlerRef.current = (input, key) => {
    if (step === "pick") {
      handlePickInput(input, key);
      return;
    }
    handleTextInput(input, key);
  };
  const stableInputHandler = useRef(
    (input: string, key: Key) => inputHandlerRef.current(input, key),
  ).current;
  useInput(stableInputHandler);

  function handlePickInput(_input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean }): void {
    if (key.escape) {
      props.onCancel();
      return;
    }
    if (key.upArrow) {
      setCursor((idx) => prevSelectable(rows, idx));
      return;
    }
    if (key.downArrow) {
      setCursor((idx) => nextSelectable(rows, idx));
      return;
    }
    if (key.return) {
      const row = rows[cursor];
      if (!row || row.kind === "divider") return;
      const initial = startDraft(row, props.stored);
      setDraft(initial);
      setBuffer(initial.baseUrl);
      setStep("url");
    }
  }

  function handleTextInput(
    input: string,
    key: {
      escape?: boolean;
      return?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
      meta?: boolean;
    },
  ): void {
    if (key.escape) {
      props.onCancel();
      return;
    }
    if (step === "confirm") {
      if (key.return) {
        if (draft) props.onSubmit(draft);
        return;
      }
      return;
    }
    if (key.backspace || key.delete || input === DEL || input === BS) {
      setBuffer((v) => v.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "w") {
      setBuffer((v) => v.replace(/\S+\s*$/, ""));
      return;
    }
    if (key.ctrl && input === "u") {
      setBuffer("");
      return;
    }
    if (key.return) {
      advance();
      return;
    }
    if (input && !key.meta && !key.ctrl && input !== DEL && input !== BS) {
      setBuffer((v) => v + input);
    }
  }

  function advance(): void {
    if (!draft) return;
    if (step === "url") {
      const trimmed = buffer.trim();
      const url = trimmed.length > 0 ? trimmed : draft.baseUrl;
      const next: ProviderDraft = { ...draft, baseUrl: url };
      setDraft(next);
      // Pre-fill the key buffer with the existing key (if any) so the user
      // can hit Enter to keep it; we keep the on-screen mask honest.
      setBuffer(next.apiKey);
      setStep("key");
      return;
    }
    if (step === "key") {
      const next: ProviderDraft = { ...draft, apiKey: buffer };
      setDraft(next);
      if (isPresetKey(next.key)) {
        // Presets skip the name step — their display name is locked.
        setStep("confirm");
        setBuffer("");
        return;
      }
      setBuffer(next.name);
      setStep("name");
      return;
    }
    if (step === "name") {
      const trimmed = buffer.trim();
      const next: ProviderDraft = {
        ...draft,
        name: trimmed.length > 0 ? trimmed : draft.name,
      };
      setDraft(next);
      setStep("confirm");
      setBuffer("");
      return;
    }
  }

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
        [provider] {stepLabel(step)}
      </Text>
      <Text color={palette.textDim}>{glyph.singleH.repeat(48)}</Text>
      {step === "pick" ? (
        <PickerList
          rows={rows}
          cursor={cursor}
          stored={props.stored}
          activeKey={props.activeKey}
        />
      ) : (
        <FieldEditor
          draft={draft}
          step={step}
          buffer={buffer}
        />
      )}
      <Box marginTop={1}>
        <Text color={palette.textDim}>
          {footerHint(step)}
        </Text>
      </Box>
    </Box>
  );
}

// --- helpers --------------------------------------------------------------

function buildRows(): Row[] {
  const rows: Row[] = [];
  const grouped = new Map<string, PresetProvider[]>();
  for (const p of PRESET_PROVIDERS) {
    const list = grouped.get(p.region) ?? [];
    list.push(p);
    grouped.set(p.region, list);
  }
  for (const region of ["international", "china", "aggregator", "self-hosted"] as const) {
    const list = grouped.get(region);
    if (!list || list.length === 0) continue;
    rows.push({ kind: "divider", label: REGION_LABELS[region] ?? region });
    for (const p of list) rows.push({ kind: "preset", preset: p });
  }
  rows.push({ kind: "divider", label: "Custom slots" });
  for (let slot = 1; slot <= CUSTOM_PROVIDER_SLOT_COUNT; slot++) {
    rows.push({ kind: "custom", slot });
  }
  return rows;
}

function nextSelectable(rows: Row[], idx: number): number {
  for (let i = 1; i <= rows.length; i++) {
    const candidate = (idx + i) % rows.length;
    if (rows[candidate]?.kind !== "divider") return candidate;
  }
  return idx;
}

function prevSelectable(rows: Row[], idx: number): number {
  for (let i = 1; i <= rows.length; i++) {
    const candidate = (idx - i + rows.length) % rows.length;
    if (rows[candidate]?.kind !== "divider") return candidate;
  }
  return idx;
}

function startDraft(row: Row, stored: Record<string, StoredProvider>): ProviderDraft {
  if (row.kind === "divider") {
    throw new Error("startDraft: divider rows are not selectable");
  }
  if (row.kind === "preset") {
    const existing = stored[row.preset.id];
    return {
      key: row.preset.id,
      name: row.preset.displayName, // locked for presets
      baseUrl: existing?.baseUrl ?? row.preset.baseUrl,
      apiKey: existing?.apiKey ?? "",
      model: existing?.model ?? row.preset.defaultModel,
      protocol: row.preset.protocol,
    };
  }
  // row.kind === "custom"
  const key = customSlotKey(row.slot);
  const existing = stored[key];
  return {
    key,
    name: existing?.name ?? `Custom ${row.slot}`,
    baseUrl: existing?.baseUrl ?? "",
    apiKey: existing?.apiKey ?? "",
    model: existing?.model ?? "",
    protocol: existing?.protocol ?? "openai-compat",
  };
}

function isPresetKey(key: string): boolean {
  if (parseCustomSlotKey(key) !== null) return false;
  return findPresetProvider(key) !== null;
}

function stepLabel(step: Step): string {
  switch (step) {
    case "pick":
      return "select a provider";
    case "url":
      return "base URL";
    case "key":
      return "API key";
    case "name":
      return "display name";
    case "confirm":
      return "review and save";
  }
}

function footerHint(step: Step): string {
  if (step === "pick") return "↑↓ select   ↵ pick   esc cancel";
  if (step === "confirm") return "↵ save   esc cancel";
  return "↵ next   esc cancel   ctrl+w erase word   ctrl+u clear";
}

// --- subviews -------------------------------------------------------------

function PickerList({
  rows,
  cursor,
  stored,
  activeKey,
}: {
  rows: Row[];
  cursor: number;
  stored: Record<string, StoredProvider>;
  activeKey: string | null;
}) {
  const visible = computeWindow(rows, cursor);
  const { palette } = useTheme();
  return (
    <Box flexDirection="column">
      {visible.map(({ row, idx }) => {
        if (row.kind === "divider") {
          return (
            <Box key={`div-${idx}`} marginTop={idx === 0 ? 0 : 1}>
              <Text color={palette.textDim} bold>
                {row.label.toUpperCase()}
              </Text>
            </Box>
          );
        }
        const key =
          row.kind === "preset" ? row.preset.id : customSlotKey(row.slot);
        const existing = stored[key];
        const active = activeKey === key;
        const marker = active ? "★" : existing ? "●" : "○";
        const cursorMark = idx === cursor ? ">" : " ";
        const label =
          row.kind === "preset"
            ? row.preset.displayName
            : existing?.name ?? `Custom ${row.slot}`;
        const tail =
          row.kind === "preset"
            ? row.preset.baseUrl
            : existing?.baseUrl ?? "(empty slot)";
        return (
          <Box key={`row-${idx}`} flexDirection="row">
            <Text
              color={idx === cursor ? palette.accent : palette.textDim}
              bold
            >{` ${cursorMark} `}</Text>
            <Text
              color={
                idx === cursor
                  ? palette.primaryActive
                  : active
                    ? palette.accent
                    : palette.text
              }
              bold
            >{`${marker} ${label.padEnd(24)}`}</Text>
            <Text color={palette.textDim}>{tail}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function FieldEditor({
  draft,
  step,
  buffer,
}: {
  draft: ProviderDraft | null;
  step: Step;
  buffer: string;
}) {
  const { palette } = useTheme();
  if (!draft) return null;
  if (step === "confirm") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.text}>
          <Text bold>name:    </Text>
          {draft.name}
        </Text>
        <Text color={palette.text}>
          <Text bold>baseUrl: </Text>
          {draft.baseUrl || "(empty — will fail at runtime)"}
        </Text>
        <Text color={palette.text}>
          <Text bold>apiKey:  </Text>
          {maskKey(draft.apiKey)}
        </Text>
        <Text color={palette.text}>
          <Text bold>model:   </Text>
          {draft.model || "(empty — set via /model later)"}
        </Text>
        <Text color={palette.textDim}>
          protocol: {draft.protocol} · key: {draft.key}
        </Text>
      </Box>
    );
  }
  const display = step === "key" ? maskKey(buffer) : buffer;
  const labelMap: Record<Exclude<Step, "pick" | "confirm">, string> = {
    url: "base URL",
    key: "API key",
    name: "display name",
  };
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.textDim}>
        provider:{" "}
        <Text color={palette.text} bold>
          {draft.name}
        </Text>{" "}
        ({draft.key})
      </Text>
      <Box marginTop={1}>
        <Text color={palette.accent} bold>
          {labelMap[step as "url" | "key" | "name"]}:{" "}
        </Text>
        <Text color={palette.text}>{display}</Text>
        <Text color={palette.primaryActive}>▍</Text>
      </Box>
      {step === "url" ? (
        <Text color={palette.textDim}>
          (leave empty to keep default: {draft.baseUrl})
        </Text>
      ) : step === "key" ? (
        <Text color={palette.textDim}>
          (empty submits leave the previously-stored key in place)
        </Text>
      ) : (
        <Text color={palette.textDim}>(empty submits keep the current name)</Text>
      )}
    </Box>
  );
}

function maskKey(apiKey: string): string {
  if (!apiKey) return "(not set)";
  const tail = apiKey.slice(-4);
  return `${"•".repeat(Math.min(8, Math.max(0, apiKey.length - 4)))}${tail}`;
}

/** Slide a fixed-size window over the row list so the cursor stays visible. */
function computeWindow(rows: Row[], cursor: number): { row: Row; idx: number }[] {
  if (rows.length <= WINDOW) {
    return rows.map((row, idx) => ({ row, idx }));
  }
  const half = Math.floor(WINDOW / 2);
  let start = Math.max(0, cursor - half);
  let end = Math.min(rows.length, start + WINDOW);
  if (end - start < WINDOW) start = Math.max(0, end - WINDOW);
  const out: { row: Row; idx: number }[] = [];
  for (let i = start; i < end; i++) {
    const r = rows[i];
    if (r) out.push({ row: r, idx: i });
  }
  return out;
}
