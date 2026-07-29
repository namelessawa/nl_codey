/** Desktop export for the shared content-minimized Run diagnostics bundle. */

import fs from "node:fs";
import { dialog } from "electron";
import { IPC, buildRunDiagnostics } from "@nlc/shared";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";
import { validateRunId } from "../validators.js";

export function registerDiagnosticsIpc(services: Services): void {
  const { storage } = services;

  handle(
    IPC.exportRunDiagnostics,
    async (raw): Promise<{ filePath: string | null }> => {
      const { runId } = validateRunId(raw);
      const run = storage.getRun(runId);
      if (!run) throw new Error("Run not found");

      const result = await dialog.showSaveDialog({
        title: "Export Run diagnostics",
        defaultPath: `nlc-diagnostics-${safeId(run.id)}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return { filePath: null };

      const bundle = buildRunDiagnostics({
        run,
        steps: storage.listSteps(run.id),
        snapshots: storage.listSnapshots(run.id),
        tasks: storage.listTaskNodes(run.id),
        gitActions: storage.listGitActions(run.id),
      });
      fs.writeFileSync(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      return { filePath: result.filePath };
    },
  );
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
