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
 * Git argv tokens that instruct git itself to execute an external program,
 * regardless of how the surrounding shell is invoked. Even with execFile and
 * no shell, `git --upload-pack=<cmd>` / `--exec=<cmd>` / `-c core.sshCommand=<cmd>`
 * will run `<cmd>`. We never legitimately need any of these in our callers,
 * so they are rejected at this boundary (CodeQL js/second-order-command-line-injection).
 */
const DANGEROUS_GIT_ARG_PATTERNS: readonly RegExp[] = [
  /^--upload-pack(=|$)/i,
  /^--receive-pack(=|$)/i,
  /^--exec(?:=|$)/i,
  /^--exec-path(=|$)/i,
  /^--config-env(=|$)/i,
];

/** Config keys that, when set via `-c key=value`, can execute commands. */
const DANGEROUS_GIT_CONFIG_KEYS: readonly RegExp[] = [
  /^core\.sshCommand=/i,
  /^core\.pager=/i,
  /^core\.editor=/i,
  /^core\.fsmonitor=/i,
  /^core\.askPass=/i,
  /^http\.proxy=/i,
  /^url\..+\.insteadOf=/i,
];

function assertSafeGitArgs(args: readonly string[]): void {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string") {
      throw new Error("git arguments must be strings");
    }
    for (const pattern of DANGEROUS_GIT_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        throw new Error(`Refusing unsafe git argument: ${arg}`);
      }
    }
    if (arg === "-c" || arg === "--config") {
      const next = args[i + 1];
      if (typeof next === "string") {
        for (const pattern of DANGEROUS_GIT_CONFIG_KEYS) {
          if (pattern.test(next)) {
            throw new Error(`Refusing unsafe git config override: ${next}`);
          }
        }
      }
    }
    if (arg.startsWith("ext::") || arg.toLowerCase().startsWith("ext:")) {
      throw new Error(`Refusing unsafe git ext:: URL: ${arg}`);
    }
  }
}

/**
 * Run `git` with the given args in `cwd`. Never uses a shell (no injection
 * surface). Captures the exit code without throwing on a non-zero status, so
 * callers can branch on `exitCode` directly. Sanitizes argv against git
 * options that would otherwise run a subordinate command (--upload-pack,
 * --exec, -c core.sshCommand=, ext:: URLs, etc.).
 */
export async function runGit(cwd: string, args: string[]): Promise<GitExecResult> {
  assertSafeGitArgs(args);
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
