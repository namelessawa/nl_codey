import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SANDBOX_CODES, SandboxError } from "./errors.js";

/**
 * One file delta produced by {@link WorkspaceSandbox.diff}. `added` and
 * `modified` carry the full text body so the caller can preview / apply
 * without re-reading the staging tree (which gets cleaned up shortly).
 * `deleted` carries the prior `before` content so we can snapshot it before
 * removing the host file.
 */
export type FileChange =
  | { kind: "added"; path: string; content: string }
  | { kind: "modified"; path: string; before: string; after: string }
  | { kind: "deleted"; path: string; before: string };

/** A binary file that changed in staging — surfaced but never auto-synced. */
export type BinaryChange = { path: string; kind: "added" | "modified" | "deleted" };

export type DiffResult = {
  changes: FileChange[];
  /** Non-empty list aborts writeback: we refuse to write opaque blobs. */
  binaryConflicts: BinaryChange[];
};

/** Directories never copied / diffed — keeps cost bounded on real projects. */
const HARD_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".cache",
  ".turbo",
  ".pnpm-store",
]);

/** Hard caps to keep one sandboxed command from copying an unbounded tree. */
const MAX_FILES = 8000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200 MB
/** Per-file size limit when treated as text — larger files copy as opaque blobs. */
const MAX_TEXT_FILE_BYTES = 1 * 1024 * 1024;

/**
 * Per-command copy-on-write staging directory under {@link os.tmpdir}. The
 * caller copies the workspace into a fresh directory, runs the sandboxed
 * command with that directory bind-mounted (so writes never reach the host
 * workspace), then diffs to discover which files changed. The diff is what
 * gets surfaced for approval — the host workspace stays pristine until the
 * user clicks Apply.
 *
 * Lifecycle: {@link prepare} → run command → {@link diff} → (apply or
 * discard) → {@link cleanup}. {@link cleanup} is best-effort and never
 * throws; always wrap the whole thing in a try/finally so a crashed run
 * still removes its staging dir.
 */
export class WorkspaceSandbox {
  /**
   * Copy the workspace to a freshly-created staging directory and return its
   * absolute path. The staging path embeds `runId` plus a UUID so concurrent
   * commands in the same run never share state.
   */
  static async prepare(workspaceRoot: string, runId: string): Promise<string> {
    const rootAbs = path.resolve(workspaceRoot);
    if (!fs.existsSync(rootAbs)) {
      throw new SandboxError(
        SANDBOX_CODES.pathEscape,
        `Workspace root does not exist: ${workspaceRoot}`,
      );
    }
    const safeRun = runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const stagingRoot = path.join(
      os.tmpdir(),
      "codey-sandbox-staging",
      `${safeRun}-${randomUUID().slice(0, 8)}`,
    );
    await fsp.mkdir(stagingRoot, { recursive: true });
    const stats = { files: 0, bytes: 0 };
    await copyTree(rootAbs, stagingRoot, stats);
    return stagingRoot;
  }

  /**
   * Compare staging against the host workspace and return a per-file delta.
   * Text files yield {@link FileChange} entries with full bodies; binary
   * additions/modifications/deletions go into `binaryConflicts` and force the
   * caller to refuse the writeback (we never sync opaque blobs without the
   * user's eyes on them).
   */
  static async diff(workspaceRoot: string, stagingRoot: string): Promise<DiffResult> {
    const rootAbs = path.resolve(workspaceRoot);
    const stagingAbs = path.resolve(stagingRoot);
    const beforeFiles = await scanFiles(rootAbs);
    const afterFiles = await scanFiles(stagingAbs);

    const changes: FileChange[] = [];
    const binaryConflicts: BinaryChange[] = [];

    const allPaths = new Set<string>([...beforeFiles.keys(), ...afterFiles.keys()]);
    const sorted = [...allPaths].sort();

    for (const rel of sorted) {
      const beforeEntry = beforeFiles.get(rel);
      const afterEntry = afterFiles.get(rel);

      // Fast-path: identical size + identical mtime → almost certainly
      // unchanged. We still verify with a content read for safety, but we
      // can skip the read when both entries are missing or identical.
      if (beforeEntry && afterEntry) {
        if (beforeEntry.size === afterEntry.size) {
          // Read both and compare bytes (cheap for small files; we capped at
          // MAX_TEXT_FILE_BYTES already and binary mismatches are rare).
          const [beforeBuf, afterBuf] = await Promise.all([
            fsp.readFile(path.join(rootAbs, rel)),
            fsp.readFile(path.join(stagingAbs, rel)),
          ]);
          if (beforeBuf.equals(afterBuf)) continue;

          if (isBinary(beforeBuf) || isBinary(afterBuf)) {
            binaryConflicts.push({ path: rel, kind: "modified" });
            continue;
          }
          changes.push({
            kind: "modified",
            path: rel,
            before: beforeBuf.toString("utf8"),
            after: afterBuf.toString("utf8"),
          });
          continue;
        }

        // Size differs → definitely changed.
        const [beforeBuf, afterBuf] = await Promise.all([
          fsp.readFile(path.join(rootAbs, rel)),
          fsp.readFile(path.join(stagingAbs, rel)),
        ]);
        if (isBinary(beforeBuf) || isBinary(afterBuf)) {
          binaryConflicts.push({ path: rel, kind: "modified" });
          continue;
        }
        changes.push({
          kind: "modified",
          path: rel,
          before: beforeBuf.toString("utf8"),
          after: afterBuf.toString("utf8"),
        });
        continue;
      }

      if (!beforeEntry && afterEntry) {
        const buf = await fsp.readFile(path.join(stagingAbs, rel));
        if (isBinary(buf)) {
          binaryConflicts.push({ path: rel, kind: "added" });
          continue;
        }
        changes.push({ kind: "added", path: rel, content: buf.toString("utf8") });
        continue;
      }

      if (beforeEntry && !afterEntry) {
        const buf = await fsp.readFile(path.join(rootAbs, rel));
        if (isBinary(buf)) {
          binaryConflicts.push({ path: rel, kind: "deleted" });
          continue;
        }
        changes.push({ kind: "deleted", path: rel, before: buf.toString("utf8") });
        continue;
      }
    }

    return { changes, binaryConflicts };
  }

  /** Recursively remove the staging directory. Never throws. */
  static async cleanup(stagingRoot: string): Promise<void> {
    try {
      await fsp.rm(stagingRoot, { recursive: true, force: true });
    } catch {
      // best-effort — temp dir cleanup is opportunistic
    }
  }
}

/** Recursively copy `src` into `dst`, honouring HARD_IGNORE and the size caps. */
async function copyTree(
  src: string,
  dst: string,
  stats: { files: number; bytes: number },
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (HARD_IGNORE.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(dstPath, { recursive: true });
      await copyTree(srcPath, dstPath, stats);
    } else if (entry.isFile()) {
      if (stats.files >= MAX_FILES) {
        throw new SandboxError(
          SANDBOX_CODES.pathEscape,
          `Sandbox prepare aborted: workspace has more than ${MAX_FILES} files (excluding ignored dirs). ` +
            "Trim the workspace or run the command in whitelist mode.",
        );
      }
      const stat = await fsp.stat(srcPath);
      stats.bytes += stat.size;
      if (stats.bytes > MAX_TOTAL_BYTES) {
        throw new SandboxError(
          SANDBOX_CODES.pathEscape,
          `Sandbox prepare aborted: workspace exceeds ${MAX_TOTAL_BYTES} bytes (excluding ignored dirs).`,
        );
      }
      stats.files += 1;
      await fsp.copyFile(srcPath, dstPath);
    } else if (entry.isSymbolicLink()) {
      // Skip symlinks — they're the textbook sandbox-escape primitive.
      // The agent's own writes never produce symlinks, and existing repo
      // symlinks (rare) are simply absent from the staging copy.
      continue;
    }
  }
}

/** Flat map of relative path → {size, mtime} for every file in `root`. */
async function scanFiles(
  root: string,
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>();
  await walk(root, root, out);
  return out;
}

async function walk(
  base: string,
  current: string,
  out: Map<string, { size: number; mtimeMs: number }>,
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (HARD_IGNORE.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(base, full, out);
    } else if (entry.isFile()) {
      try {
        const stat = await fsp.stat(full);
        if (stat.size > MAX_TEXT_FILE_BYTES) continue; // skip oversized — treated as binary
        const rel = path
          .relative(base, full)
          .split(path.sep)
          .join("/");
        out.set(rel, { size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // file vanished mid-walk — fine, just skip
      }
    }
  }
}

/**
 * Heuristic binary check: any NUL byte in the first 8KB → binary. Same
 * approach as git, ripgrep, and the existing `readFileTool` so the agent
 * sees a consistent definition of "binary".
 */
function isBinary(buf: Buffer): boolean {
  const slice = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < slice.length; i += 1) {
    if (slice[i] === 0) return true;
  }
  return false;
}
