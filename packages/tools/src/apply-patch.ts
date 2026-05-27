import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { applyPatch, parsePatch } from "diff";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import type { ApplyPatchInput, ApplyPatchOutput, ToolContext } from "@coding-agent/shared";
import { TOOL_CODES, ToolError } from "./errors.js";
import type { SnapshotStore } from "./deps.js";

type PlannedChange = {
  relPath: string;
  absPath: string;
  before: string;
  after: string;
  existed: boolean;
};

/**
 * Apply a unified diff transactionally:
 *  1. Parse + compute every file's new content first (read-only).
 *  2. Only if ALL hunks apply cleanly, snapshot then write each file.
 * A malformed or non-applying patch therefore never corrupts the project.
 */
export async function applyPatchTool(
  input: ApplyPatchInput,
  ctx: ToolContext,
  store: SnapshotStore,
): Promise<ApplyPatchOutput> {
  const patches = parsePatch(input.patch);
  if (patches.length === 0) {
    throw new ToolError(TOOL_CODES.patchInvalid, "Patch contains no file changes");
  }

  // Phase A — compute all new contents; abort before writing if anything fails.
  const planned: PlannedChange[] = [];
  for (const fp of patches) {
    const relPath = targetPath(fp.oldFileName, fp.newFileName);
    if (!relPath) {
      throw new ToolError(TOOL_CODES.patchInvalid, "Patch is missing a target file name");
    }
    const absPath = assertInsideWorkspace(ctx.workspaceRoot, relPath);
    const existed = existsSync(absPath);
    const before = existed ? await fs.readFile(absPath, "utf8") : "";

    const result = applyPatch(before, fp);
    if (result === false) {
      throw new ToolError(
        TOOL_CODES.patchApplyFailed,
        `Hunk did not apply cleanly to ${relPath} (file may have changed)`,
      );
    }
    planned.push({ relPath, absPath, before, after: result, existed });
  }

  // Phase B — snapshot + write. Safe to mutate now that all hunks resolved.
  const changedFiles: string[] = [];
  for (const change of planned) {
    const snap = store.addSnapshot(input.runId, change.relPath, change.before);
    await fs.mkdir(dirOf(change.absPath), { recursive: true });
    await fs.writeFile(change.absPath, change.after, "utf8");
    store.setSnapshotAfter(snap.id, change.after);
    changedFiles.push(change.relPath);
  }

  return { applied: true, changedFiles };
}

function targetPath(oldName: string | undefined, newName: string | undefined): string | null {
  const candidate = newName && newName !== "/dev/null" ? newName : oldName;
  if (!candidate || candidate === "/dev/null") return null;
  return candidate.replace(/^[ab]\//, "").split("\\").join("/");
}

function dirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? "." : p.slice(0, idx);
}
