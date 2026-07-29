import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (...parts) => path.join(root, ...parts);
const read = (...parts) => fs.readFileSync(rel(...parts), "utf8");

const commandSource = read("apps", "cli", "src", "tui", "commands.ts");
const appSource = read("apps", "cli", "src", "tui", "ink-tui.tsx");
const terminalLayoutSource = read(
  "apps",
  "cli",
  "src",
  "tui",
  "terminal-layout.ts",
);
const promptSource = read("apps", "cli", "src", "tui", "prompt.tsx");
const promptEditorSource = read(
  "apps",
  "cli",
  "src",
  "tui",
  "prompt-editor.ts",
);
const promptImplementationSource = `${promptSource}\n${promptEditorSource}`;
const approvalSource = read("apps", "cli", "src", "tui", "approval.tsx");
const providerSource = read("apps", "cli", "src", "tui", "provider-picker.tsx");
const skillSource = read("apps", "cli", "src", "tui", "skill-install-picker.tsx");
const commandTestPath = rel("apps", "cli", "src", "tui", "commands.test.ts");
const commandTestSource = fs.existsSync(commandTestPath)
  ? fs.readFileSync(commandTestPath, "utf8")
  : "";
const inputRenderTestPath = rel(
  "apps",
  "cli",
  "src",
  "tui",
  "inputs.render.test.tsx",
);
const inputRenderTestSource = fs.existsSync(inputRenderTestPath)
  ? fs.readFileSync(inputRenderTestPath, "utf8")
  : "";
const promptEditorTestPath = rel(
  "apps",
  "cli",
  "src",
  "tui",
  "prompt-editor.test.ts",
);
const promptEditorTestSource = fs.existsSync(promptEditorTestPath)
  ? fs.readFileSync(promptEditorTestPath, "utf8")
  : "";
const ptyTestPath = rel(
  "apps",
  "cli",
  "src",
  "tui",
  "conpty.pty.test.ts",
);
const ptyTestSource = fs.existsSync(ptyTestPath)
  ? fs.readFileSync(ptyTestPath, "utf8")
  : "";

function discoverTestFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverTestFiles(absolute);
    return /\.test\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

const cliTuiTestFiles = discoverTestFiles(rel("apps", "cli", "src")).map(
  (file) => path.relative(root, file).replaceAll("\\", "/"),
);
const commandRegistryCovered =
  commandTestSource.includes('describe("[tui] command registry"') &&
  commandTestSource.includes("for (const spec of COMMANDS)");

const commandSpecs = [];
for (const match of commandSource.matchAll(/\{\s*name:\s*"([^"]+)",\s*hint:\s*"([^"]+)"\s*\}/g)) {
  commandSpecs.push({ name: match[1], hint: match[2] });
}
if (commandSpecs.length === 0) {
  throw new Error("No TUI command specs discovered in commands.ts");
}

function discoverParserGroups(source) {
  const groups = [];
  let aliases = [];
  let returnKinds = [];

  const flush = () => {
    if (aliases.length === 0) return;
    const effect = returnKinds.at(-1);
    if (!effect) {
      throw new Error(`Parser cases have no returned effect: ${aliases.join(", ")}`);
    }
    groups.push({ aliases, effect });
    aliases = [];
    returnKinds = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const caseMatch = line.match(/^\s*case\s+"([^"]+)":/);
    if (caseMatch) {
      if (returnKinds.length > 0) flush();
      aliases.push(caseMatch[1]);
      continue;
    }
    const returnMatch = line.match(/return\s+\{\s*kind:\s*"([^"]+)"/);
    if (returnMatch && aliases.length > 0) {
      returnKinds.push(returnMatch[1]);
      continue;
    }
    if (/^\s*default:/.test(line)) flush();
  }
  flush();
  return groups;
}

const parserGroups = discoverParserGroups(commandSource);
const parserByAlias = new Map();
for (const group of parserGroups) {
  for (const alias of group.aliases) parserByAlias.set(alias, group);
}

const handledEffects = new Set(
  [...appSource.matchAll(/^\s*case\s+"([^"]+)":/gm)].map((match) => match[1]),
);

const effectMetadata = {
  noop: {
    precondition: "Prompt focused",
    result: "No operation",
    mutation: "No",
  },
  exit: {
    precondition: "No blocking modal",
    result: "Exit the Ink application",
    mutation: "Process state",
  },
  clear: {
    precondition: "Idle prompt",
    result: "Clear the in-memory message stream",
    mutation: "In-memory UI",
  },
  "show-help": {
    precondition: "Idle prompt",
    result: "Append command catalogue to the message stream",
    mutation: "In-memory UI",
  },
  "list-workspaces": {
    precondition: "Idle prompt",
    result: "Currently displays an ABI-gap notice instead of workspace data",
    mutation: "No",
  },
  "show-settings": {
    precondition: "Readable CLI settings",
    result: "Append resolved non-secret settings",
    mutation: "In-memory UI",
  },
  "switch-workspace": {
    precondition: "Path argument",
    result: "Currently reports that workspace switching is not wired",
    mutation: "No (scaffold)",
  },
  init: {
    precondition: "Writable workspace; --force for replacement",
    result: "Create or update the project .nlc skeleton",
    mutation: "Workspace files",
  },
  "list-skills": {
    precondition: "Readable global/project skill roots",
    result: "Append discovered skills",
    mutation: "No",
  },
  "skills-generate": {
    precondition: "Description; configured LLM; install-target approval",
    result: "Generate and install a skill",
    mutation: "LLM call + project/global files",
  },
  theme: {
    precondition: "Known theme when an argument is supplied",
    result: "List themes or switch active theme and record a session event",
    mutation: "UI + session event",
  },
  sessions: {
    precondition: "Readable session store",
    result: "Append session summaries",
    mutation: "No",
  },
  tree: {
    precondition: "Readable session store",
    result: "Append the session tree",
    mutation: "No",
  },
  branch: {
    precondition: "Message id and active/explicit parent session",
    result: "Create and activate a child session",
    mutation: "Session store",
  },
  resume: {
    precondition: "Resolvable session id/prefix",
    result: "Switch active JSONL session and replay history without running tools",
    mutation: "Active session",
  },
  rollback: {
    precondition: "Completed run with persisted snapshots",
    result: "Restore the latest or uniquely selected run snapshots",
    mutation: "Workspace files + run status",
  },
  model: {
    precondition: "provider/model syntax when changing",
    result: "Show model or record a model-change event; runtime settings are not changed",
    mutation: "Session event only",
  },
  think: {
    precondition: "Optional level",
    result: "Show limitation or record a thinking-level event",
    mutation: "Session event only",
  },
  provider: {
    precondition: "Readable provider store",
    result: "Open picker; save provider config and model-change event on confirmation",
    mutation: "Provider store + session event",
  },
  unknown: {
    precondition: "Unrecognized command or invalid required arguments",
    result: "Append a user-facing error",
    mutation: "In-memory UI",
  },
};

const commandRows = commandSpecs.map((spec) => {
  const base = spec.name.split(/\s+/)[0].slice(1);
  const parser = parserByAlias.get(base);
  if (!parser) throw new Error(`Catalog command has no parser case: ${spec.name}`);
  if (!handledEffects.has(parser.effect) && !["exit", "noop"].includes(parser.effect)) {
    throw new Error(`Parser effect has no InnerApp handler: ${parser.effect}`);
  }
  const metadata = effectMetadata[parser.effect];
  if (!metadata) throw new Error(`Missing inventory metadata for effect: ${parser.effect}`);
  return {
    action: spec.name,
    entry: "Prompt",
    keys: [base, ...parser.aliases.filter((alias) => alias !== base)]
      .map((alias) => `/${alias}`)
      .join(", "),
    ...metadata,
    test: commandRegistryCovered
      ? "apps/cli/src/tui/commands.test.ts ([tui] registry/parser)"
      : "None",
  };
});

function requirePattern(source, pattern, label) {
  if (!pattern.test(source)) throw new Error(`Keyboard action pattern not found: ${label}`);
}

const keyboardRows = [
  ["Global", "Ctrl+C", appSource, /key\.ctrl\s*&&\s*input\s*===\s*"c"[\s\S]*loop\.isRunning/, "Cancel an active run; an empty idle prompt exits"],
  ["Terminal", "Resize below 80 columns", `${appSource}\n${terminalLayoutSource}`, /stdout\.on\("resize"[\s\S]*NARROW_TERMINAL_COLUMNS/, "Reflow the frame and hide the trace panel"],
  ["Terminal", "Resize below 60x20", terminalLayoutSource, /MIN_TERMINAL_COLUMNS[\s\S]*MIN_TERMINAL_ROWS[\s\S]*isTooSmall/, "Replace the full frame with a size warning while retaining input ownership"],
  ["Prompt", "Enter", promptSource, /case\s+"submit"[\s\S]*submitPrompt/, "Submit once as a task or slash command; ignore blank/whitespace input"],
  ["Prompt", "Backspace/Delete/Ctrl+H/BS/DEL", promptEditorSource, /DELETE_SEQUENCES[\s\S]*case\s+"backspace"[\s\S]*case\s+"delete"/, "Erase one Unicode code point before or at the cursor"],
  ["Prompt", "Left/Right", promptImplementationSource, /LEFT_SEQUENCES[\s\S]*RIGHT_SEQUENCES[\s\S]*case\s+"left"[\s\S]*case\s+"right"/, "Move the Unicode code-point cursor one position"],
  ["Prompt", "Home/End", promptImplementationSource, /HOME_SEQUENCES[\s\S]*END_SEQUENCES[\s\S]*case\s+"home"[\s\S]*case\s+"end"/, "Move the cursor to the start or end"],
  ["Prompt", "Ctrl+W", promptImplementationSource, /value\s*===\s*"\\u0017"[\s\S]*type:\s*"delete-word"/, "Erase the previous word at the cursor"],
  ["Prompt", "Ctrl+U", promptImplementationSource, /value\s*===\s*"\\u0015"[\s\S]*type:\s*"clear"/, "Clear the input"],
  ["Prompt", "Up/Down", promptImplementationSource, /case\s+"up"[\s\S]*history-previous[\s\S]*case\s+"down"[\s\S]*history-next/, "Move through command suggestions or prompt history"],
  ["Prompt", "PageUp/PageDown", promptImplementationSource, /case\s+"page-up"[\s\S]*case\s+"page-down"[\s\S]*PAGE_UP_SEQUENCES[\s\S]*PAGE_DOWN_SEQUENCES/, "Reserve terminal page-navigation sequences without mutating the prompt draft; terminal scrollback remains terminal-owned"],
  ["Prompt", "Tab/Shift+Tab", promptEditorSource, /value\s*===\s*"\\t"[\s\S]*value\s*===\s*"\\u001b\[Z"[\s\S]*type:\s*"tab"/, "Complete or reverse-select slash-command suggestions"],
  ["Prompt", "Escape", promptSource, /case\s+"escape"[\s\S]*type:\s*"clear"/, "Clear prompt and command suggestions"],
  ["Prompt", "Ctrl+C", promptEditorSource, /value\s*===\s*"\\u0003"[\s\S]*type:\s*"interrupt"/, "Clear a non-empty prompt; exit when already empty"],
  ["Prompt", "Ctrl+Enter", promptEditorSource, /CTRL_ENTER_SEQUENCES[\s\S]*type:\s*"insert",\s*text:\s*"\\n"/, "Insert a newline when the terminal exposes a distinct modified sequence"],
  ["Prompt", "Text / bracketed paste", promptEditorSource, /BRACKETED_PASTE_START[\s\S]*sanitizePromptText[\s\S]*MAX_PASTE_BUFFER_CODE_UNITS/, "Insert CJK/multiline text, filter controls and cap input at 16,384 code points"],
  ["Approval", "Y", approvalSource, /k\s*===\s*"y"/, "Approve the pending patch"],
  ["Approval", "N/Q", approvalSource, /k\s*===\s*"n"\s*\|\|\s*k\s*===\s*"q"/, "Reject the pending patch"],
  ["Provider picker", "Up/Down", providerSource, /key\.upArrow[\s\S]*key\.downArrow/, "Move through providers"],
  ["Provider picker", "Enter", providerSource, /if\s*\(key\.return\)/, "Advance or save"],
  ["Provider picker", "Escape", providerSource, /if\s*\(key\.escape\)/, "Cancel the picker"],
  ["Provider editor", "Backspace/Delete, Ctrl+W, Ctrl+U", providerSource, /key\.backspace[\s\S]*input\s*===\s*"w"[\s\S]*input\s*===\s*"u"/, "Edit the active field"],
  ["Skill install picker", "Up/Down", skillSource, /key\.upArrow[\s\S]*key\.downArrow/, "Move through install targets"],
  ["Skill install picker", "Enter", skillSource, /if\s*\(key\.return\)/, "Confirm the install target"],
  ["Skill install picker", "Escape/Q", skillSource, /key\.escape\s*\|\|\s*input\.toLowerCase\(\)\s*===\s*"q"/, "Cancel skill generation"],
];
for (const [, key, source, pattern, result] of keyboardRows) {
  requirePattern(source, pattern, `${key}: ${result}`);
}

const inputRenderEvidence = new Map([
  ["Prompt\u0000Enter", "command/plain and duplicate-submit guards"],
  ["Prompt\u0000Backspace/Delete/Ctrl+H/BS/DEL", "Windows DEL and CJK editing"],
  ["Prompt\u0000Left/Right", "CJK cursor editing"],
  ["Prompt\u0000Home/End", "CJK start/end editing"],
  ["Prompt\u0000Ctrl+W", "word erase"],
  ["Prompt\u0000Ctrl+U", "line clear"],
  ["Prompt\u0000Up/Down", "suggestion navigation and history recall"],
  ["Prompt\u0000PageUp/PageDown", "safe reserved no-op with draft preservation"],
  ["Prompt\u0000Tab/Shift+Tab", "forward/reverse command selection"],
  ["Prompt\u0000Escape", "prompt/palette clear"],
  ["Prompt\u0000Ctrl+C", "clear-then-cancel behavior"],
  ["Prompt\u0000Text / bracketed paste", "multiline paste and modal/run focus"],
  ["Approval\u0000Y", "approval callback"],
  ["Approval\u0000N/Q", "rejection callback"],
  ["Provider picker\u0000Up/Down", "two-way navigation"],
  ["Provider picker\u0000Enter", "step advance"],
  ["Provider picker\u0000Escape", "cancel callback"],
  ["Provider editor\u0000Backspace/Delete, Ctrl+W, Ctrl+U", "field editing"],
  ["Skill install picker\u0000Up/Down", "two-way navigation"],
  ["Skill install picker\u0000Enter", "target callback"],
  ["Skill install picker\u0000Escape/Q", "cancel and busy ownership"],
]);
const requiredInputEvidence = [
  "handles Windows DEL input",
  "edits CJK text with Home, End, Left, Backspace and forward Delete",
  "recalls prompt history and prevents duplicate blank submission",
  "preserves the prompt draft when PageUp and PageDown are reserved",
  "navigates command suggestions with Down and reverse Tab",
  "handles Ctrl+W, Ctrl+U, Escape and two-stage idle Ctrl+C",
  "preserves input across hidden modal focus and submits multiline paste",
  "edits provider fields with Backspace, Delete, Ctrl+W and Ctrl+U",
  "cancels the skill picker with Escape or Q but not while busy",
  "routes approval keys",
  "navigates both directions in the skill picker",
  "navigates, advances and cancels the provider picker",
];
const inputEvidenceReady =
  inputRenderTestSource.length > 0 &&
  requiredInputEvidence.every((needle) => inputRenderTestSource.includes(needle));
const inputRenderTestLabel =
  "apps/cli/src/tui/inputs.render.test.tsx ([tui-render])";
const promptUnitEvidenceReady =
  promptEditorTestSource.includes('describe("[tui] prompt editor state machine"') &&
  promptEditorTestSource.includes("decodes Windows and ANSI editing keys") &&
  promptEditorTestSource.includes("normalizes multiline paste") &&
  promptEditorTestSource.includes("tokenizes coalesced ConPTY editing keys") &&
  promptEditorTestSource.includes(
    "recognizes coalesced and split PageUp/PageDown without text insertion",
  );
const promptUnitTestLabel =
  "apps/cli/src/tui/prompt-editor.test.ts ([tui])";
const ptyEvidenceReady =
  ptyTestSource.includes('describeWindows("[tui-pty] Windows PTY lifecycle"') &&
  ptyTestSource.includes("renders, resizes, completes /help and exits cleanly") &&
  ptyTestSource.includes("Terminal 59x19 is too small.") &&
  ptyTestSource.includes("Terminal 50x16 is too small.") &&
  ptyTestSource.includes("turns idle Ctrl+C into deterministic process cleanup") &&
  ptyTestSource.includes("preserves a prompt draft across PageUp and PageDown") &&
  ptyTestSource.includes(
    "edits Unicode paste, preserves a draft across resize and recalls history",
  );
const ptyTestLabel = "apps/cli/src/tui/conpty.pty.test.ts ([tui-pty])";

const modalNames = [
  ...new Set(
    [...appSource.matchAll(/<(Approval|[A-Z][A-Za-z]*Picker)\b/g)].map(
      (match) => match[1],
    ),
  ),
];
if (modalNames.length === 0) throw new Error("No TUI modal routes discovered");

const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (headers, rows) => [
  `| ${headers.join(" | ")} |`,
  `| ${headers.map(() => "---").join(" | ")} |`,
  ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
].join("\n");

const commandTable = table(
  ["Action", "Entry", "Shortcut/command", "Precondition", "Result", "Mutates state", "Test"],
  commandRows.map((row) => [
    row.action,
    row.entry,
    row.keys,
    row.precondition,
    row.result,
    row.mutation,
    row.test,
  ]),
);

const keyboardInventoryRows = keyboardRows.map(
  ([surface, key, , , result]) => {
    const inputEvidence = inputRenderEvidence.get(`${surface}\u0000${key}`);
    const evidence = [];
    if (inputEvidenceReady && inputEvidence) {
      evidence.push(`${inputRenderTestLabel} - ${inputEvidence}`);
    }
    if (
      promptUnitEvidenceReady &&
      surface === "Prompt" &&
      ["Ctrl+Enter", "PageUp/PageDown", "Text / bracketed paste"].includes(key)
    ) {
      evidence.push(promptUnitTestLabel);
    }
    const ptyEvidence =
      ptyEvidenceReady &&
      ((surface === "Global" && key === "Ctrl+C") ||
        (surface === "Terminal" &&
          ["Resize below 80 columns", "Resize below 60x20"].includes(key)) ||
        (surface === "Prompt" &&
          [
            "Left/Right",
            "Home/End",
            "Up/Down",
            "PageUp/PageDown",
            "Text / bracketed paste",
          ].includes(key)));
    if (ptyEvidence) evidence.push(ptyTestLabel);
    return [surface, key, result, evidence.length > 0 ? evidence.join("; ") : "None"];
  },
);
const incompleteKeyboardRows = keyboardInventoryRows.filter(
  (row) => row[3] === "None",
).length;
const keyboardTable = table(
  ["Surface", "Key", "Implemented result", "Automated test"],
  keyboardInventoryRows,
);

const modalTable = table(
  ["Modal route", "Open path", "Input ownership", "Automated test"],
  modalNames.map((name) => {
    const pathByName = {
      Approval: "Agent emits patch_ready",
      ProviderPicker: "/provider",
      SkillInstallPicker: "/skills-generate <description>",
    };
    const modalCovered =
      inputEvidenceReady &&
      ["Approval", "ProviderPicker", "SkillInstallPicker"].includes(name);
    return [
      name,
      pathByName[name] ?? "Discovered in InnerApp JSX",
      "Modal blocks global/prompt input",
      modalCovered ? inputRenderTestLabel : "None",
    ];
  }),
);

const hasMouse = fs.existsSync(rel("apps", "cli", "src", "tui", "mouse.ts"));
const output = `# TUI action inventory

> Generated by \`pnpm docs:tui-actions\`. Do not edit the generated tables by
> hand. The generator reads the slash-command catalogue/parser, the InnerApp
> effect/modal routes, and each committed input component. Generation fails
> when a catalogued command lacks a parser/host handler or inventory metadata.

## Discovery summary

- Catalogued slash commands: ${commandRows.length}
- Parser alias groups: ${parserGroups.length}
- Keyboard/input actions: ${keyboardRows.length}
- Keyboard rows without test identifiers: ${incompleteKeyboardRows}
- Modal routes: ${modalNames.length}
- Mouse implementation discovered: ${hasMouse ? "yes" : "no"}
- Committed CLI/TUI Vitest files: ${cliTuiTestFiles.length}

## Slash commands

${commandTable}

## Keyboard and text-input actions

${keyboardTable}

The prompt editor has committed unit, Ink-render and native ConPTY evidence for
Unicode cursor editing, Home/End, history, bounded multiline paste, control
filtering, resize preservation and modal/run input ownership. PageUp/PageDown
are explicitly recognized as safe reserved no-ops: they preserve the draft,
while scrollback remains owned by the terminal.

## Modal routes

${modalTable}

The help catalogue is appended to the message stream; it is not a modal.
Session list/tree are also stream messages rather than interactive pickers.

## Mouse actions

${hasMouse ? "Mouse source exists and requires a dedicated interaction audit." : "No mouse handler or mouse-mode lifecycle is committed. Mouse support must not be advertised as production-ready."}

## Coverage gate

This inventory is discovery evidence, not completion evidence. Slash-command
catalogue/parser and committed Ink interaction coverage are recorded where
present. ConPTY startup, Unicode/paste editing, resize preservation, history,
help completion, normal exit and idle Ctrl+C are covered on Windows.
${incompleteKeyboardRows === 0 ? "Every discovered keyboard/input row has a committed test identifier." : `${incompleteKeyboardRows} keyboard/input rows still say \`None\` and remain incomplete.`}
CI must regenerate this file and fail on a diff.
`;

const outputPath = rel("docs", "tui", "action-inventory.md");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(
  `Wrote ${path.relative(root, outputPath)} (${commandRows.length} commands, ${keyboardRows.length} keyboard actions, ${modalNames.length} modals)\n`,
);
