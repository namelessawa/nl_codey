import { spawn, type ChildProcess } from "node:child_process";

const WINDOWS_BATCH_WINDOW_MS = 10;
const WINDOWS_DIRECT_KILL_FALLBACK_MS = 750;
const pendingWindowsChildren = new Map<number, ChildProcess>();
let windowsBatchTimer: NodeJS.Timeout | undefined;

/**
 * Terminate a spawned command and its descendants without invoking a shell.
 *
 * Windows has no process-group signal equivalent, so taskkill performs the
 * tree walk. POSIX callers must spawn the child as a detached process group;
 * that group receives TERM followed by a bounded KILL fallback. Failures fall
 * back to killing the direct child.
 */
export function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (typeof pid !== "number" || child.exitCode !== null) return;

  if (process.platform === "win32") {
    queueWindowsTreeKill(pid, child);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill();
  }
  const force = setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 750);
  force.unref();
}

/**
 * Coalesce simultaneous cancellations into one taskkill process. Starting many
 * taskkill processes at once is itself slow under Windows CI load and can push
 * an otherwise prompt cancellation beyond the public timing contract.
 */
function queueWindowsTreeKill(pid: number, child: ChildProcess): void {
  pendingWindowsChildren.set(pid, child);
  if (windowsBatchTimer) return;
  windowsBatchTimer = setTimeout(flushWindowsTreeKills, WINDOWS_BATCH_WINDOW_MS);
}

function flushWindowsTreeKills(): void {
  windowsBatchTimer = undefined;
  const batch = [...pendingWindowsChildren.entries()];
  pendingWindowsChildren.clear();
  if (batch.length === 0) return;

  const args = batch.flatMap(([pid]) => ["/PID", String(pid)]);
  args.push("/T", "/F");
  const killer = spawn("taskkill.exe", args, {
    windowsHide: true,
    stdio: "ignore",
  });
  killer.unref();
  const killDirectChildren = (): void => {
    for (const [, child] of batch) {
      if (child.exitCode === null) child.kill();
    }
  };
  const fallback = setTimeout(killDirectChildren, WINDOWS_DIRECT_KILL_FALLBACK_MS);
  fallback.unref();
  const finish = (): void => {
    clearTimeout(fallback);
    killDirectChildren();
  };
  killer.once("error", finish);
  killer.once("close", finish);
}
