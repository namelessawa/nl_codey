import fs from "node:fs";
import type { AgentStepType, FileSnapshot } from "@nlc/shared";
import { assertInsideWorkspace } from "@nlc/sandbox";

export type RollbackArgs = {
  workspaceRoot: string;
  snapshots: FileSnapshot[];
  addStep: (type: AgentStepType, content: string) => void;
};

/**
 * Restore each snapshotted file to its before-content. Files that were newly
 * created (empty before-content) are deleted. Warns when a file's current
 * content no longer matches what the agent wrote (external modification).
 */
export function rollbackRun(args: RollbackArgs): void {
  const { workspaceRoot, snapshots, addStep } = args;
  if (snapshots.length === 0) {
    addStep("message", "Nothing to roll back (no snapshots)");
    return;
  }

  // Reverse order so files edited multiple times restore to their earliest state.
  for (const snap of [...snapshots].reverse()) {
    let abs: string;
    try {
      abs = assertInsideWorkspace(workspaceRoot, snap.filePath);
    } catch (err) {
      addStep("error", `Skip rollback of ${snap.filePath}: ${asMessage(err)}`);
      continue;
    }

    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    if (snap.afterContent !== undefined && current !== null && current !== snap.afterContent) {
      addStep("error", `Warning: ${snap.filePath} changed externally since the edit; restoring anyway`);
    }

    try {
      if (snap.beforeContent === "") {
        if (current !== null) fs.rmSync(abs, { force: true });
        addStep("message", `Removed created file ${snap.filePath}`);
      } else {
        fs.writeFileSync(abs, snap.beforeContent, "utf8");
        addStep("message", `Restored ${snap.filePath}`);
      }
    } catch (err) {
      addStep("error", `Failed to restore ${snap.filePath}: ${asMessage(err)}`);
    }
  }

  addStep("message", "Rolled back changes");
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
