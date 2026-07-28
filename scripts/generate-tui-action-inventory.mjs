import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (...parts) => path.join(root, ...parts);
const read = (...parts) => fs.readFileSync(rel(...parts), "utf8");

const commandSource = read("apps", "cli", "src", "tui", "commands.ts");
const appSource = read("apps", "cli", "src", "tui", "ink-tui.tsx");
const promptSource = read("apps", "cli", "src", "tui", "prompt.tsx");
const approvalSource = read("apps", "cli", "src", "tui", "approval.tsx");
const providerSource = read("apps", "cli", "src", "tui", "provider-picker.tsx");
const skillSource = read("apps", "cli", "src", "tui", "skill-install-picker.tsx");
const commandTestPath = rel("apps", "cli", "src", "tui", "commands.test.ts");
const commandTestSource = fs.existsSync(commandTestPath)
  ? fs.readFileSync(commandTestPath, "utf8")
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
    result: "Switch active JSONL session",
    mutation: "Active session",
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
  ["Global", "Ctrl+C", appSource, /key\.ctrl\s*&&\s*input\s*===\s*"c"/, "Cancel an active run; otherwise exit"],
  ["Prompt", "Enter", promptSource, /if\s*\(key\.return\)/, "Submit a task or slash command; ignore blank input"],
  ["Prompt", "Backspace/Delete/Ctrl+H/BS/DEL", promptSource, /function isErase\(/, "Erase the final code unit"],
  ["Prompt", "Ctrl+W", promptSource, /key\.ctrl\s*&&\s*input\s*===\s*"w"/, "Erase the previous word"],
  ["Prompt", "Ctrl+U", promptSource, /key\.ctrl\s*&&\s*input\s*===\s*"u"/, "Clear the input"],
  ["Prompt", "Up/Down", promptSource, /key\.upArrow[\s\S]*key\.downArrow/, "Move through command suggestions"],
  ["Prompt", "Tab", promptSource, /if\s*\(key\.tab\)/, "Complete the selected slash command"],
  ["Prompt", "Escape", promptSource, /if\s*\(key\.escape\)/, "Clear prompt and command suggestions"],
  ["Prompt", "Ctrl+C", promptSource, /key\.ctrl\s*&&\s*input\s*===\s*"c"/, "Clear prompt input"],
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

const keyboardTable = table(
  ["Surface", "Key", "Implemented result", "Automated test"],
  keyboardRows.map(([surface, key, , , result]) => [
    surface,
    key,
    result,
    "None",
  ]),
);

const modalTable = table(
  ["Modal route", "Open path", "Input ownership", "Automated test"],
  modalNames.map((name) => {
    const pathByName = {
      Approval: "Agent emits patch_ready",
      ProviderPicker: "/provider",
      SkillInstallPicker: "/skills-generate <description>",
    };
    return [name, pathByName[name] ?? "Discovered in InnerApp JSX", "Modal blocks global/prompt input", "None"];
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
- Modal routes: ${modalNames.length}
- Mouse implementation discovered: ${hasMouse ? "yes" : "no"}
- Committed CLI/TUI Vitest files: ${cliTuiTestFiles.length}

## Slash commands

${commandTable}

## Keyboard and text-input actions

${keyboardTable}

Not implemented in the current prompt editor: cursor movement, Home/End,
history recall, multiline paste semantics, PageUp/PageDown message navigation,
or preservation tests across resize.

## Modal routes

${modalTable}

The help catalogue is appended to the message stream; it is not a modal.
Session list/tree are also stream messages rather than interactive pickers.

## Mouse actions

${hasMouse ? "Mouse source exists and requires a dedicated interaction audit." : "No mouse handler or mouse-mode lifecycle is committed. Mouse support must not be advertised as production-ready."}

## Coverage gate

This inventory is discovery evidence, not completion evidence. Slash-command
catalogue/parser coverage is recorded where present; keyboard, modal, render,
PTY, and E2E rows still require stable test identifiers. CI must regenerate
this file and fail on a diff.
`;

const outputPath = rel("docs", "tui", "action-inventory.md");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(
  `Wrote ${path.relative(root, outputPath)} (${commandRows.length} commands, ${keyboardRows.length} keyboard actions, ${modalNames.length} modals)\n`,
);
