import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Max bytes of git output captured before truncation by the OS buffer. */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type GitExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

/**
 * Run `git` with the given args in `cwd`. Never uses a shell (no injection
 * surface). Captures the exit code without throwing on a non-zero status, so
 * callers can branch on `exitCode` directly.
 */
export async function runGit(cwd: string, args: string[]): Promise<GitExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    return normalizeExecError(error);
  }
}

/** Turn a rejected execFile promise into a non-throwing result. */
function normalizeExecError(error: unknown): GitExecResult {
  const err = error as {
    code?: number | string;
    stdout?: string;
    stderr?: string;
    message?: string;
  };
  const exitCode = typeof err.code === "number" ? err.code : 1;
  return {
    stdout: err.stdout ?? "",
    stderr: err.stderr ?? err.message ?? "",
    exitCode,
  };
}

/** True when `cwd` is inside a git working tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}
