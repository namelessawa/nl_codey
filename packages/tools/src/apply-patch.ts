import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { applyPatch, parsePatch } from "diff";
import { assertInsideWorkspace } from "@coding-agent/sandbox";
import type { ApplyPatchInput, ApplyPatchOutput, ToolContext } from "@coding-agent/shared";
import { TOOL_CODES, ToolError } from "./errors.js";
import type { SnapshotStore } from "./deps.js";
import { applyV4AHunks, isV4APatch, parseV4A } from "./v4a.js";

type ChangeOp = "update" | "add" | "delete";

type PlannedChange = {
  op: ChangeOp;
  relPath: string;
  absPath: string;
  before: string;
  after: string;
  existed: boolean;
};

/**
 * Apply a patch transactionally:
 *  1. Parse + compute every file's new content first (read-only).
 *  2. Only if ALL changes resolve cleanly, snapshot then write/delete each file.
 * A malformed or non-applying patch therefore never corrupts the project.
 *
 * Supports two formats: V4A (context-based, preferred — detected by the
 * `*** Begin Patch` envelope) and unified diff (Phase 1 compatibility).
 *
 * If a write or delete partway through Phase B fails (disk full, permission,
 * antivirus locked the file), the helper rolls back every file it already
 * touched in this call to its pre-patch contents using the snapshots taken
 * moments earlier. The originating error is then re-thrown. This keeps the
 * workspace consistent — either all of the patch lands, or none of it does.
 */
export async function applyPatchTool(
  input: ApplyPatchInput,
  ctx: ToolContext,
  store: SnapshotStore,
): Promise<ApplyPatchOutput> {
  const planned = isV4APatch(input.patch)
    ? await planV4A(input.patch, ctx)
    : await planUnified(input.patch, ctx);

  if (planned.length === 0) {
    throw new ToolError(TOOL_CODES.patchInvalid, "Patch contains no file changes");
  }

  // Phase B — snapshot + write/delete. Safe to mutate now that all changes
  // resolved cleanly. Track every file we touched so a mid-loop failure can
  // unwind back to the pre-patch state.
  const changedFiles: string[] = [];
  const applied: PlannedChange[] = [];
  for (const change of planned) {
    const snap = store.addSnapshot(input.runId, change.relPath, change.before);
    try {
      if (change.op === "delete") {
        if (change.existed) await fs.rm(change.absPath, { force: true });
        store.setSnapshotAfter(snap.id, "");
      } else {
        await fs.mkdir(dirOf(change.absPath), { recursive: true });
        await fs.writeFile(change.absPath, change.after, "utf8");
        store.setSnapshotAfter(snap.id, change.after);
      }
    } catch (writeErr) {
      // Roll back every file we managed to mutate in this call so the
      // workspace returns to the pre-patch state instead of being left half-
      // written. Failures inside the rollback itself are surfaced after the
      // primary error.
      const rollbackErrors: string[] = [];
      for (const prior of [...applied].reverse()) {
        try {
          if (prior.op === "add") {
            // We created the file; restore by deleting it.
            await fs.rm(prior.absPath, { force: true });
          } else {
            // We modified or deleted an existing file; restore the bytes.
            await fs.mkdir(dirOf(prior.absPath), { recursive: true });
            await fs.writeFile(prior.absPath, prior.before, "utf8");
          }
        } catch (rollbackErr) {
          rollbackErrors.push(
            `${prior.relPath}: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
          );
        }
      }
      const primary = writeErr instanceof Error ? writeErr.message : String(writeErr);
      const note =
        rollbackErrors.length === 0
          ? `Patch write failed on ${change.relPath} (${primary}); rolled back ${applied.length} prior file change(s).`
          : `Patch write failed on ${change.relPath} (${primary}); rollback also failed for: ${rollbackErrors.join("; ")}. Manual recovery may be needed.`;
      throw new ToolError(TOOL_CODES.patchApplyFailed, note);
    }
    applied.push(change);
    changedFiles.push(change.relPath);
  }

  return { applied: true, changedFiles };
}

/** Phase A for unified diffs: compute new content for each file. */
async function planUnified(patch: string, ctx: ToolContext): Promise<PlannedChange[]> {
  const patches = parsePatch(patch);
  if (patches.length === 0) {
    throw new ToolError(TOOL_CODES.patchInvalid, "Patch contains no file changes");
  }
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
    planned.push({ op: existed ? "update" : "add", relPath, absPath, before, after: result, existed });
  }
  return planned;
}

/** Phase A for V4A patches: resolve each file op against current content. */
async function planV4A(patch: string, ctx: ToolContext): Promise<PlannedChange[]> {
  const ops = parseV4A(patch);
  const planned: PlannedChange[] = [];
  for (const op of ops) {
    const absPath = assertInsideWorkspace(ctx.workspaceRoot, op.path);
    const existed = existsSync(absPath);
    const before = existed ? await fs.readFile(absPath, "utf8") : "";

    if (op.op === "delete") {
      if (!existed) {
        throw new ToolError(TOOL_CODES.patchApplyFailed, `Cannot delete missing file: ${op.path}`);
      }
      planned.push({ op: "delete", relPath: op.path, absPath, before, after: "", existed });
    } else if (op.op === "add") {
      // V4A "Add File" must NOT silently overwrite an existing file. A
      // conflict here is almost always the model misreading the workspace —
      // refusing instead of clobbering gives the loop a chance to either
      // emit an Update File patch or stop and ask. Use Update File for any
      // intentional rewrite.
      if (existed) {
        throw new ToolError(
          TOOL_CODES.patchApplyFailed,
          `Cannot add ${op.path}: file already exists. Use "Update File" to modify, or delete it first.`,
        );
      }
      planned.push({ op: "add", relPath: op.path, absPath, before, after: op.content, existed });
    } else {
      if (!existed) {
        throw new ToolError(
          TOOL_CODES.patchApplyFailed,
          `Cannot update missing file: ${op.path} (use Add File instead)`,
        );
      }
      const after = applyV4AHunks(before, op.hunks, op.path);
      planned.push({ op: "update", relPath: op.path, absPath, before, after, existed });
    }
  }
  return planned;
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
