import { writeLine } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";
import { CLI_VERSION } from "../lib/version.js";

const HELP = `nlc ${CLI_VERSION} — NL_Codey command line

Usage:
  nlc                       Open the terminal UI (placeholder; see notes below).
  nlc gui                   Launch the desktop GUI in the background.
  nlc run "<task>"          Run a one-shot agent task against the current dir.
  nlc settings              Show the resolved settings (~/.nlc/settings.json).
  nlc settings get <key>    Print a single dotted-path key (e.g. llm.model).
  nlc workspaces            List workspaces that have been opened before.
  nlc sessions [list]       List session JSON files for the current workspace.
  nlc sessions tree         Render the project's conversation tree (git-style).
  nlc sessions show <id>    Dump one session file as raw JSONL.
  nlc help                  Show this help.
  nlc --version             Print the CLI version.

Options:
  --workspace <path>        Pick the workspace root (default: current dir).
  --data-root <path>        Override ~/.nlc (also: NLC_HOME env var).
  --yes, -y                 Auto-approve patches (use with care).
  --no-color                Disable ANSI colours.
  --json                    Emit JSON to stdout instead of human prose.
  --host-protocol           Host-adapter NDJSON mode; requires --json and
                            accepts explicit approval messages on stdin.

Data:
  Everything persistent — settings.json, apikey.bin, the SQLite run
  database, snapshots, semantic index — lives under ~/.nlc. The GUI is
  just another view of this directory; nothing else stores state.

Environment:
  NLC_HOME                  Override ~/.nlc.
  NLC_API_KEY               Cross-provider API key override for nlc run.
  ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY,
  OPENROUTER_API_KEY, GEMINI_API_KEY
                            Provider-specific keys; consulted when the GUI
                            settings.json does not include a key (the GUI
                            encrypts its key via OS keychain, which the
                            CLI cannot decrypt).
`;

export function runHelp(_args: ParsedArgs): number {
  writeLine(HELP);
  return 0;
}
