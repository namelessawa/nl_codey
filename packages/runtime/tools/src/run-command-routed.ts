import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DockerRunner,
  WorkspaceSandbox,
  WslRunner,
  routeCommand,
  type FileChange,
  type BinaryChange,
} from "@nlc/sandbox";
import { detectProject } from "@nlc/project-indexer";
import {
  type ProjectKind,
  type RunCommandInput,
  type RunCommandOutput,
  type SandboxPolicy,
  type ToolContext,
  TOOL_LIMITS,
} from "@nlc/shared";
import { runCommandTool } from "./run-command.js";
import type { SnapshotStore } from "./deps.js";

/**
 * Default Docker image for a given project kind. Pulled lazily by Docker on
 * first use. Keep these images small (slim/alpine variants) so the first-run
 * latency stays within the 60s command timeout.
 */
export function defaultDockerImage(kind: ProjectKind): string {
  switch (kind) {
    case "python":
      return "python:3.12-slim";
    case "node":
      return "node:22-slim";
    case "go":
      return "golang:1.22-bookworm";
    case "rust":
      return "rust:1.78-slim";
    default:
      return "python:3.12-slim";
  }
}

/**
 * What to do with the file changes a sandboxed command produced.
 *
 * - `auto`: apply every change immediately + snapshot for rollback. Used for
 *   commands the user explicitly invoked (Run Command panel) or for
 *   project-native verify/baseline runs whose side effects (coverage reports,
 *   etc.) belong to the project lifecycle.
 * - `approve`: hand the change set to the supplied callback; if it resolves
 *   `true`, apply + snapshot; otherwise discard. Used by the agent loop so
 *   the model can't write to the host workspace without the user clicking
 *   Apply on a preview.
 * - `discard`: drop the changes (staging is wiped). Safe default — never
 *   reaches the host workspace.
 */
export type WritebackMode =
  | { kind: "auto" }
  | { kind: "approve"; onApprove: (changes: FileChange[]) => Promise<boolean> }
  | { kind: "discard" };

export type RunCommandOptions = {
  policy?: SandboxPolicy;
  writeback?: WritebackMode;
  /** Required when writeback is `auto` or an approved `approve`. */
  snapshotStore?: SnapshotStore;
};

/**
 * Result of a routed command: the standard {@link RunCommandOutput} plus a
 * report on what the sandbox attempted to write. `applied` is true when those
 * changes reached the host workspace (either auto or after explicit approval);
 * `binaryConflicts` is non-empty when the command produced binary writes —
 * we refuse to sync opaque blobs and surface them to the caller instead.
 */
export type RoutedCommandResult = RunCommandOutput & {
  /** Changes the sandbox produced (whether applied or discarded). */
  changes: FileChange[];
  /** Binary additions/modifications/deletions. Never auto-applied. */
  binaryConflicts: BinaryChange[];
  /** True when changes were written through to the host workspace. */
  applied: boolean;
};

/**
 * Heuristic project-kind detection that also peeks for `*.py` / `requirements.txt`
 * even when no `pyproject.toml`/`pytest.ini` is present. The base
 * {@link detectProject} requires those manifests, so a freshly-generated test
 * project (where the agent just wrote `fizzbuzz.py` + `requirements.txt`) would
 * still be reported as "unknown" without this peek.
 */
function detectKind(workspaceRoot: string): ProjectKind {
  const base = detectProject(workspaceRoot).kind;
  if (base !== "unknown") return base;
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && (e.name === "requirements.txt" || e.name.endsWith(".py")))) {
      return "python";
    }
    if (entries.some((e) => e.isFile() && e.name === "package.json")) return "node";
    if (entries.some((e) => e.isFile() && e.name === "go.mod")) return "go";
    if (entries.some((e) => e.isFile() && e.name === "Cargo.toml")) return "rust";
  } catch {
    // Workspace unreadable: stick with unknown so the caller picks its default.
  }
  return "unknown";
}

/** A no-op result used when whitelist mode returns through the new wrapper. */
function emptyChanges(out: RunCommandOutput): RoutedCommandResult {
  return { ...out, changes: [], binaryConflicts: [], applied: false };
}

/**
 * Run a shell command, routed through the active sandbox policy.
 *
 * - `whitelist` (default / policy missing): existing Phase 2 behavior — the
 *   command runs on the host with the exact-match allowlist + dangerous-pattern
 *   guards. `changes` is always empty in this mode (the host command writes
 *   directly to the workspace, and we make no attempt to sandbox it — the
 *   allowlist itself is the gate).
 * - `docker` / `wsl`: the workspace is copied to a per-command staging
 *   directory under `os.tmpdir()`, the runner is pointed at the staging dir
 *   instead of the real workspace, and after the command finishes
 *   {@link WorkspaceSandbox.diff} tells us which files the command attempted
 *   to write. Those changes are then handled per `options.writeback`:
 *   `auto` applies them immediately, `approve` parks for user approval,
 *   `discard` throws them away. The host workspace is NEVER touched until
 *   the writeback step decides to apply.
 *
 * Network egress and command-escape patterns are still enforced by the
 * underlying {@link routeCommand} dispatcher.
 */
export async function runCommandWithPolicy(
  input: RunCommandInput,
  ctx: ToolContext,
  options: RunCommandOptions = {},
): Promise<RoutedCommandResult> {
  const policy = options.policy;
  const writeback: WritebackMode = options.writeback ?? { kind: "discard" };

  if (!policy || policy.mode === "whitelist") {
    return emptyChanges(await runCommandTool.run(input, ctx));
  }

  const timeoutMs = input.timeoutMs ?? TOOL_LIMITS.commandTimeoutMs;
  const effectivePolicy: SandboxPolicy =
    policy.mode === "docker" && !policy.dockerImage
      ? { ...policy, dockerImage: defaultDockerImage(detectKind(ctx.workspaceRoot)) }
      : policy;

  const stagingRoot = await WorkspaceSandbox.prepare(ctx.workspaceRoot, ctx.runId);
  try {
    const runners = {
      whitelist: (req: { command: string }) =>
        runCommandTool
          .run({ command: req.command, timeoutMs }, ctx)
          .then((out) => ({
            command: out.command,
            mode: "whitelist" as const,
            exitCode: out.exitCode,
            stdout: out.stdout,
            stderr: out.stderr,
            timedOut: out.timedOut,
            changedFiles: [] as string[],
          })),
      wsl: new WslRunner(),
      docker: new DockerRunner(),
    };

    const runResult = await routeCommand(
      {
        command: input.command,
        // The runner sees the staging dir as the "workspace" — its bind mount
        // (docker) or cwd (wsl) is staged so any writes land in staging, not
        // the real workspace. The host workspaceRoot is preserved on ctx for
        // anything else that needs it.
        workspaceRoot: stagingRoot,
        runId: ctx.runId,
        timeoutMs,
        // Forward the run's abort signal so a user-initiated Stop kills the
        // sandbox child immediately instead of waiting out the 60s timeout.
        // The runner rejects with AbortError on abort; the catch below maps
        // that to an empty change set so writeback never runs against a
        // half-mutated staging dir.
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      },
      effectivePolicy,
      runners,
    );

    const output: RunCommandOutput = {
      command: runResult.command,
      exitCode: runResult.exitCode,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      timedOut: runResult.timedOut,
    };

    const diff = await WorkspaceSandbox.diff(ctx.workspaceRoot, stagingRoot);
    if (diff.changes.length === 0 && diff.binaryConflicts.length === 0) {
      return { ...output, changes: [], binaryConflicts: [], applied: false };
    }

    // Binary changes block all writeback: we never sync opaque blobs without
    // an explicit per-file user decision (out of scope for v1).
    if (diff.binaryConflicts.length > 0) {
      return {
        ...output,
        changes: diff.changes,
        binaryConflicts: diff.binaryConflicts,
        applied: false,
      };
    }

    let applied = false;
    if (writeback.kind === "auto") {
      await applyChanges(diff.changes, ctx, options.snapshotStore);
      applied = true;
    } else if (writeback.kind === "approve") {
      const ok = await writeback.onApprove(diff.changes);
      if (ok) {
        await applyChanges(diff.changes, ctx, options.snapshotStore);
        applied = true;
      }
    }
    // writeback.kind === "discard" — fall through, nothing applied.

    return {
      ...output,
      changes: diff.changes,
      binaryConflicts: diff.binaryConflicts,
      applied,
    };
  } finally {
    await WorkspaceSandbox.cleanup(stagingRoot);
  }
}

/**
 * Mirror an approved change set into the host workspace, snapshotting each
 * file (under the run's id) before writing or removing so rollback can undo
 * the sync. Snapshot store is optional only because some test harnesses run
 * with `writeback: "discard"`; when changes are actually applied a missing
 * store is a programming error and we throw.
 */
async function applyChanges(
  changes: FileChange[],
  ctx: ToolContext,
  store: SnapshotStore | undefined,
): Promise<void> {
  if (!store) {
    throw new Error(
      "snapshotStore is required when writeback applies changes (auto / approved). " +
        "Pass options.snapshotStore from the caller's storage layer.",
    );
  }
  const root = ctx.workspaceRoot;
  for (const change of changes) {
    const abs = path.join(root, change.path);
    if (change.kind === "deleted") {
      const snap = store.addSnapshot(ctx.runId, change.path, change.before, {
        beforeExisted: true,
      });
      await fsp.rm(abs, { force: true });
      store.setSnapshotAfter(snap.id, "", false);
      continue;
    }
    const before = change.kind === "modified" ? change.before : "";
    const after = change.kind === "modified" ? change.after : change.content;
    const snap = store.addSnapshot(ctx.runId, change.path, before, {
      beforeExisted: change.kind === "modified",
    });
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, after, "utf8");
    store.setSnapshotAfter(snap.id, after);
  }
}
