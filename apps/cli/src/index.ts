/**
 * `nlc` — NL_Codey command line entry point.
 *
 * Both install methods (npm and the .exe installer) ship the same `nlc`
 * program. Running `nlc` with no arguments opens the terminal UI; `nlc gui`
 * spawns the Electron desktop window in the background. The GUI is "just"
 * another nlc process — both views read/write the same `~/.nlc` data root,
 * so settings, runs and snapshots are shared.
 */
import process from "node:process";
import { runDefault } from "./commands/default.js";
import { runGui } from "./commands/gui.js";
import { runRun } from "./commands/run.js";
import { runSettings } from "./commands/settings.js";
import { runHelp } from "./commands/help.js";
import { runWorkspaces } from "./commands/workspaces.js";
import { runSessions } from "./commands/sessions.js";
import { CLI_VERSION } from "./lib/version.js";
import { parseArgv, type ParsedArgs } from "./lib/argv.js";
import { writeErrLine } from "./lib/format.js";

type Command = (args: ParsedArgs) => Promise<number> | number;

const REGISTRY: Record<string, Command> = {
  gui: runGui,
  run: runRun,
  settings: runSettings,
  workspaces: runWorkspaces,
  sessions: runSessions,
  help: runHelp,
};

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv);

  if (parsed.flags.has("version") || parsed.flags.has("V")) {
    process.stdout.write(`nlc ${CLI_VERSION}\n`);
    return 0;
  }
  if (parsed.flags.has("help") || parsed.flags.has("h")) {
    return runHelp(parsed);
  }

  const subcommand = parsed.positional[0];
  if (!subcommand) return runDefault(parsed);

  const handler = REGISTRY[subcommand];
  if (!handler) {
    writeErrLine(`nlc: unknown command "${subcommand}". Try \`nlc help\`.`);
    return 2;
  }

  // Strip the subcommand from positionals so handlers see their own args at index 0.
  const sub: ParsedArgs = {
    ...parsed,
    positional: parsed.positional.slice(1),
  };
  return handler(sub);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    writeErrLine(`nlc: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
