import fs from "node:fs";
import path from "node:path";
import { SANDBOX_CODES, SandboxError } from "./errors.js";

/**
 * Resolve `targetPath` (absolute or relative to `workspaceRoot`) to a canonical
 * absolute path and assert it stays inside the workspace root.
 *
 * Defends against:
 *  - `..` traversal
 *  - absolute paths pointing elsewhere / other drives
 *  - symlink escapes (by resolving the deepest existing ancestor via realpath)
 *  - Windows path separator inconsistencies
 *
 * Works for not-yet-existing targets (e.g. a file about to be written): the
 * nearest existing ancestor is realpath-resolved, then the remaining segments
 * are appended.
 */
export function assertInsideWorkspace(workspaceRoot: string, targetPath: string): string {
  const root = canonicalize(path.resolve(workspaceRoot));
  const requested = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(root, targetPath);
  const resolved = canonicalize(requested);

  if (!isInside(root, resolved)) {
    throw new SandboxError(
      SANDBOX_CODES.pathEscape,
      `Path escapes workspace root: ${targetPath}`,
    );
  }
  return resolved;
}

/** True when `target` is the root itself or nested within it. */
export function isInside(root: string, target: string): boolean {
  const normRoot = normalizeForCompare(root);
  const normTarget = normalizeForCompare(target);
  if (normRoot === normTarget) return true;
  const rel = path.relative(normRoot, normTarget);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * realpath the deepest existing ancestor of `p`, then re-append the trailing
 * (not-yet-existing) segments. This collapses symlinks even for new paths.
 */
function canonicalize(p: string): string {
  let current = p;
  const trailing: string[] = [];
  // Walk upward until we hit a path that exists on disk.
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return trailing.length === 0 ? real : path.join(real, ...trailing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached filesystem root without finding anything that exists.
        return p;
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

function normalizeForCompare(p: string): string {
  const normalized = path.normalize(p);
  // Windows file systems are case-insensitive; compare case-folded there.
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
