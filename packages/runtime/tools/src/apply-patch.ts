import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { applyPatch, parsePatch } from "diff";
import { assertInsideWorkspace } from "@nlc/sandbox";
import type { ApplyPatchInput, ApplyPatchOutput, ToolContext } from "@nlc/shared";
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
      // Roll back every file we mutated, INCLUDING the current one. fs.writeFile
      // is not atomic — a failure mid-write (ENOSPC, antivirus lock after
      // truncate, transient EIO) can leave the file partial on disk. Restoring
      // `change.before` for the failing file too is what keeps the documented
      // "all or nothing" guarantee true in those cases. For brand-new "add"
      // ops the partial bytes are removed since the file did not exist before.
      // Failures inside the rollback itself are surfaced after the primary
      // error so the caller can decide what to do.
      const rollbackErrors: string[] = [];
      const toRollback: PlannedChange[] = [change, ...[...applied].reverse()];
      for (const prior of toRollback) {
        try {
          if (prior.op === "add" && !prior.existed) {
            // We created (or partially created) the file; remove any bytes
            // that landed on disk.
            await fs.rm(prior.absPath, { force: true });
          } else {
            // We modified, deleted, or re-added a previously-existing file;
            // restore the pre-patch bytes verbatim.
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
          ? `Patch write failed on ${change.relPath} (${primary}); rolled back ${applied.length} prior file change(s) and restored the failing file.`
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

  // Track per-path evolving state as ops apply in order. Critical for patches
  // with multiple Update / Add / Delete blocks on the same file: a second op's
  // hunk must see the first op's result, NOT the unmodified on-disk content.
  // Without this, Phase A planned the second op against stale bytes and
  // Phase B's two writes would silently overwrite each other (last-write-wins,
  // earlier hunk dropped). The collapse at the end also dedups `changedFiles`.
  type FileState = {
    absPath: string;
    initialBefore: string;
    initialExisted: boolean;
    current: string;
    exists: boolean;
  };
  const states = new Map<string, FileState>();

  for (const op of ops) {
    const absPath = assertInsideWorkspace(ctx.workspaceRoot, op.path);
    let state = states.get(op.path);
    if (!state) {
      const existed = existsSync(absPath);
      const before = existed ? await fs.readFile(absPath, "utf8") : "";
      state = {
        absPath,
        initialBefore: before,
        initialExisted: existed,
        current: before,
        exists: existed,
      };
      states.set(op.path, state);
    }

    if (op.op === "delete") {
      if (!state.exists) {
        throw new ToolError(TOOL_CODES.patchApplyFailed, `Cannot delete missing file: ${op.path}`);
      }
      state.current = "";
      state.exists = false;
    } else if (op.op === "add") {
      // V4A "Add File" must NOT silently overwrite a file that exists in the
      // current (in-memory) state — either it was on disk pre-patch or an
      // earlier op already created it. Refusing keeps the model honest:
      // intentional rewrites must use "Update File".
      if (state.exists) {
        throw new ToolError(
          TOOL_CODES.patchApplyFailed,
          `Cannot add ${op.path}: file already exists. Use "Update File" to modify, or delete it first.`,
        );
      }
      state.current = op.content;
      state.exists = true;
    } else {
      if (!state.exists) {
        throw new ToolError(
          TOOL_CODES.patchApplyFailed,
          `Cannot update missing file: ${op.path} (use Add File instead)`,
        );
      }
      state.current = applyV4AHunks(state.current, op.hunks, op.path);
    }
  }

  // Collapse each path's final state into one PlannedChange. Net-zero paths
  // (e.g. add-then-delete of a file that didn't exist) are skipped — Phase B
  // has nothing to do for them. Paths reborn (delete-then-add when the file
  // initially existed) collapse to a single "update" with the rewritten body.
  const planned: PlannedChange[] = [];
  for (const [relPath, s] of states) {
    if (!s.initialExisted && !s.exists) continue;
    let op: ChangeOp;
    if (!s.initialExisted && s.exists) op = "add";
    else if (s.initialExisted && !s.exists) op = "delete";
    else op = "update";
    planned.push({
      op,
      relPath,
      absPath: s.absPath,
      before: s.initialBefore,
      after: op === "delete" ? "" : s.current,
      existed: s.initialExisted,
    });
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
