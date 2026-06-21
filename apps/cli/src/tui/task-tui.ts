/**
 * Placeholder TUI. The plumbing — workspace selection, task input, streaming
 * output, line-mode y/n approval — is real; the surface is intentionally
 * minimal so we can ship one end-to-end vertical slice and iterate.
 *
 * The richer terminal UI (Ink-based, full split panes, run history, settings
 * panel) is deferred until after the CLI ↔ GUI surface is shaken out.
 */
import path from "node:path";
import { ask, yesNo } from "../lib/prompts.js";
import { c, writeLine, writeErrLine } from "../lib/format.js";
import { runRun } from "../commands/run.js";
import type { ParsedArgs } from "../lib/argv.js";

export async function runTaskTui(args: ParsedArgs, dataRoot: string): Promise<number> {
  writeLine(c.cyan("Placeholder TUI — single-shot task loop."));
  writeLine(c.gray(`(workspace = ${args.flags.get("workspace") ?? process.cwd()})`));
  writeLine(c.gray("Hit Ctrl+C to exit at any time."));
  writeLine("");

  while (true) {
    const task = (await ask(c.bold("task> "))).trim();
    if (!task) continue;
    if (task === "exit" || task === "quit" || task === ":q") return 0;

    // Reuse the headless `nlc run` plumbing — passing the task as positional
    // arg 0 and inheriting any --workspace / --yes / --json the user gave us.
    const subArgs: ParsedArgs = {
      ...args,
      positional: [task],
    };
    try {
      const code = await runRun(subArgs);
      if (code !== 0) {
        writeErrLine(c.yellow(`(task exited with code ${code})`));
      }
    } catch (err) {
      writeErrLine(c.red(`task crashed: ${err instanceof Error ? err.message : String(err)}`));
    }

    writeLine("");
    const again = await yesNo("Run another task?", true);
    if (!again) return 0;
  }
}

/** Display the workspace root in a stable, short form. */
export function shortWorkspace(root: string): string {
  return path.basename(root) || root;
}
