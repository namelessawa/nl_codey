import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentStepType, FileSnapshot } from "@nlc/shared";
import { assertInsideWorkspace } from "@nlc/sandbox";

export type RollbackArgs = {
  workspaceRoot: string;
  snapshots: FileSnapshot[];
  addStep: (type: AgentStepType, content: string) => void;
};

export type RollbackResult = {
  restoredFiles: string[];
  warnings: string[];
};

export class RollbackError extends Error {
  readonly failures: string[];
  readonly compensationFailures: string[];

  constructor(failures: string[], compensationFailures: string[] = []) {
    const compensation =
      compensationFailures.length === 0
        ? ""
        : ` Compensation also failed for: ${compensationFailures.join("; ")}.`;
    super(`Rollback failed: ${failures.join("; ")}.${compensation}`);
    this.name = "RollbackError";
    this.failures = failures;
    this.compensationFailures = compensationFailures;
  }
}

type RollbackTarget = {
  filePath: string;
  absPath: string;
  beforeContent: string;
  beforeExisted: boolean;
  afterContent?: string;
  afterExisted?: boolean;
  currentExisted: boolean;
  currentBytes: Buffer;
};

/**
 * Restore each unique snapshotted path to its earliest state.
 *
 * Every path is resolved and read before the first mutation. If a restore
 * fails after earlier paths changed, those paths are compensated back to the
 * exact bytes observed when rollback began. Legacy snapshots without an
 * existence bit are treated as pre-existing files, which may leave an empty
 * file but will never delete one based on ambiguous historical data.
 */
export function rollbackRun(args: RollbackArgs): RollbackResult {
  const { workspaceRoot, snapshots, addStep } = args;
  if (snapshots.length === 0) {
    addStep("message", "Nothing to roll back (no snapshots)");
    return { restoredFiles: [], warnings: [] };
  }

  const failures: string[] = [];
  const targetsByPath = new Map<string, Omit<RollbackTarget, "currentExisted" | "currentBytes">>();
  for (const snap of snapshots) {
    let abs: string;
    try {
      abs = assertInsideWorkspace(workspaceRoot, snap.filePath);
    } catch (err) {
      failures.push(`${snap.filePath}: ${asMessage(err)}`);
      continue;
    }
    const key = normalizedPathKey(abs);
    const existing = targetsByPath.get(key);
    if (existing) {
      existing.afterContent = snap.afterContent;
      existing.afterExisted = snap.afterExisted;
    } else {
      targetsByPath.set(key, {
        filePath: snap.filePath,
        absPath: abs,
        beforeContent: snap.beforeContent,
        beforeExisted: snap.beforeExisted !== false,
        afterContent: snap.afterContent,
        afterExisted: snap.afterExisted,
      });
    }
  }

  const targets: RollbackTarget[] = [];
  for (const target of targetsByPath.values()) {
    try {
      const { existed: currentExisted, bytes: currentBytes } = readCurrentPath(target.absPath);
      targets.push({ ...target, currentExisted, currentBytes });
    } catch (err) {
      failures.push(`${target.filePath}: unable to read current state (${asMessage(err)})`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) addStep("error", `Rollback preflight failed: ${failure}`);
    throw new RollbackError(failures);
  }

  const warnings: string[] = [];
  for (const target of targets) {
    if (!matchesExpectedAfter(target)) {
      const warning =
        `${target.filePath} changed externally since the recorded edit; restoring anyway`;
      warnings.push(warning);
      addStep("error", `Warning: ${warning}`);
    }
  }

  const applied: RollbackTarget[] = [];
  for (const target of targets) {
    try {
      restorePath(target.absPath, target.beforeExisted, Buffer.from(target.beforeContent, "utf8"));
      applied.push(target);
    } catch (err) {
      const primary = `${target.filePath}: ${asMessage(err)}`;
      const compensationFailures: string[] = [];
      for (const changed of [target, ...[...applied].reverse()]) {
        try {
          restorePath(changed.absPath, changed.currentExisted, changed.currentBytes);
        } catch (compensationErr) {
          compensationFailures.push(`${changed.filePath}: ${asMessage(compensationErr)}`);
        }
      }
      addStep("error", `Rollback failed: ${primary}`);
      for (const failure of compensationFailures) {
        addStep("error", `Rollback compensation failed: ${failure}`);
      }
      throw new RollbackError([primary], compensationFailures);
    }
  }

  for (const target of targets) {
    addStep(
      "message",
      target.beforeExisted
        ? `Restored ${target.filePath}`
        : `Removed created file ${target.filePath}`,
    );
  }
  addStep("message", "Rolled back changes");
  return { restoredFiles: targets.map((target) => target.filePath), warnings };
}

function readCurrentPath(absPath: string): { existed: boolean; bytes: Buffer } {
  try {
    return { existed: true, bytes: fs.readFileSync(absPath) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { existed: false, bytes: Buffer.alloc(0) };
    }
    throw err;
  }
}

function matchesExpectedAfter(target: RollbackTarget): boolean {
  if (target.afterExisted !== undefined) {
    if (target.afterExisted !== target.currentExisted) return false;
    if (!target.afterExisted) return true;
    return target.currentBytes.equals(Buffer.from(target.afterContent ?? "", "utf8"));
  }
  if (target.afterContent === undefined || !target.currentExisted) return true;
  return target.currentBytes.equals(Buffer.from(target.afterContent, "utf8"));
}

function restorePath(absPath: string, existed: boolean, bytes: Buffer): void {
  if (!existed) {
    fs.rmSync(absPath, { force: true });
    return;
  }
  const parent = path.dirname(absPath);
  fs.mkdirSync(parent, { recursive: true });
  const tempPath = path.join(
    parent,
    `.${path.basename(absPath)}.nlc-rollback-${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, bytes, { flag: "wx" });
    fs.renameSync(tempPath, absPath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The primary write/rename error is more useful than temp cleanup noise.
    }
  }
}

function normalizedPathKey(absPath: string): string {
  const resolved = path.resolve(absPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
