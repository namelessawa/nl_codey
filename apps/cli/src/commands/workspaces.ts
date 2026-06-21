import { Storage } from "@nlc/storage";
import { nlcRoot } from "@nlc/shared";
import path from "node:path";
import { writeLine, writeErrLine, c } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";

/** `nlc workspaces` — list previously opened workspaces from ~/.nlc/data. */
export async function runWorkspaces(args: ParsedArgs): Promise<number> {
  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const dbPath = path.join(dataRoot, "data", "workspace-state.db");
  let storage: Storage;
  try {
    storage = new Storage(dbPath);
  } catch (err) {
    writeErrLine(
      `nlc: could not open the workspace database at ${dbPath}.\n` +
        `      ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const rows = storage.listWorkspaces(50);
  storage.close();

  if (args.flags.has("json")) {
    writeLine(JSON.stringify(rows, null, 2));
    return 0;
  }

  if (rows.length === 0) {
    writeLine("No workspaces yet. Open one with `nlc gui` or `nlc run` in a project dir.");
    return 0;
  }
  for (const ws of rows) {
    const when = new Date(ws.openedAt).toISOString().replace("T", " ").slice(0, 16);
    writeLine(`${c.gray(when)}  ${ws.rootPath}`);
  }
  return 0;
}
