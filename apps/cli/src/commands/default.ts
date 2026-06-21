import path from "node:path";
import { nlcRoot } from "@nlc/shared";
import { writeLine, c } from "../lib/format.js";
import { runTaskTui } from "../tui/task-tui.js";
import { runInkTui } from "../tui/ink-tui.js";
import type { ParsedArgs } from "../lib/argv.js";

/**
 * Default command — `nlc` with no subcommand.
 *
 * When stdout is a TTY (and the user didn't pass `--plain`), we mount the
 * Ink-based TUI (cool teal + magenta theme, right-side trace, `:cmd`
 * ex-style commands). Without a TTY (pipes, CI), we fall back to the
 * readline placeholder so the binary still works in non-interactive
 * contexts.
 */
export async function runDefault(args: ParsedArgs): Promise<number> {
  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const workspaceRoot = path.resolve(args.flags.get("workspace") ?? process.cwd());
  const wantsPlain = args.flags.has("plain");
  const hasTty = process.stdout.isTTY === true && process.stdin.isTTY === true;

  if (!hasTty || wantsPlain) {
    writeLine(c.bold("nlc — NL_Codey terminal UI (plain mode)"));
    writeLine(c.gray(`data root: ${dataRoot}`));
    writeLine(c.gray("type `nlc help` for the full command reference"));
    writeLine("");
    return runTaskTui(args, dataRoot);
  }

  await runInkTui({
    workspaceRoot,
    dataRoot,
    autoApprove: args.flags.has("yes") || args.flags.has("y"),
  });
  return 0;
}
