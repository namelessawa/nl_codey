/** `nlc diagnostics <run-id>` — export a content-minimized Run bundle. */

import fs from "node:fs";
import path from "node:path";
import { Storage } from "@nlc/storage";
import { buildRunDiagnostics, nlcRoot } from "@nlc/shared";
import { writeErrLine, writeLine } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";

export async function runDiagnostics(args: ParsedArgs): Promise<number> {
  const runId = args.positional[0];
  if (!runId) {
    writeErrLine(
      "nlc diagnostics: missing run id. Usage: nlc diagnostics <run-id> [--output <path>]",
    );
    return 2;
  }
  const rawOutput = args.flags.get("output");
  if (rawOutput === "true") {
    writeErrLine("nlc diagnostics: --output requires a path or '-'.");
    return 2;
  }
  if (args.flags.has("json") && rawOutput && rawOutput !== "-") {
    writeErrLine(
      "nlc diagnostics: --json writes to stdout and cannot be combined with a file output.",
    );
    return 2;
  }

  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const dbPath = path.join(dataRoot, "data", "workspace-state.db");
  let storage: Storage;
  try {
    storage = new Storage(dbPath);
  } catch (error) {
    writeErrLine(`nlc diagnostics: could not open Run storage. ${error}`);
    return 1;
  }

  try {
    const run = storage.getRun(runId);
    if (!run) {
      writeErrLine(`nlc diagnostics: Run not found: ${runId}`);
      return 2;
    }
    const bundle = buildRunDiagnostics({
      run,
      steps: storage.listSteps(run.id),
      snapshots: storage.listSnapshots(run.id),
      tasks: storage.listTaskNodes(run.id),
      gitActions: storage.listGitActions(run.id),
    });
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
    if (args.flags.has("json") || rawOutput === "-") {
      process.stdout.write(serialized);
      return 0;
    }

    const target = path.resolve(
      rawOutput ?? path.join(process.cwd(), `nlc-diagnostics-${safeId(run.id)}.json`),
    );
    const parent = path.dirname(target);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      writeErrLine(`nlc diagnostics: output directory does not exist: ${parent}`);
      return 2;
    }
    fs.writeFileSync(target, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    writeLine(`Diagnostics exported to ${target}`);
    return 0;
  } catch (error) {
    writeErrLine(`nlc diagnostics: export failed. ${error}`);
    return 1;
  } finally {
    storage.close();
  }
}

function safeId(value: string): string {
  let safe = "";
  for (const char of value.slice(0, 80)) {
    const code = char.charCodeAt(0);
    const allowed =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      char === "-" ||
      char === "_" ||
      char === ".";
    safe += allowed ? char : "_";
  }
  return safe || "run";
}
