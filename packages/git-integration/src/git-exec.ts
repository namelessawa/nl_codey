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
 * Git argv prefixes that instruct git itself to execute an external program,
 * regardless of how the surrounding shell is invoked. Even with execFile and
 * no shell, `git --upload-pack=<cmd>` / `--exec=<cmd>` / `-c core.sshCommand=<cmd>`
 * will run `<cmd>`. We never legitimately need any of these in our callers,
 * so they are rejected at this boundary (CodeQL js/second-order-command-line-injection).
 *
 * Checks use `String.prototype.startsWith` rather than regex so the static
 * data-flow analyzer recognizes them as a sanitizer barrier.
 */
const DANGEROUS_GIT_ARG_PREFIXES: readonly string[] = [
  "--upload-pack",
  "--receive-pack",
  "--exec=",
  "--exec ",
  "--exec-path",
  "--config-env",
];

/** Config keys that, when set via `-c key=value`, can execute commands. */
const DANGEROUS_GIT_CONFIG_KEY_PREFIXES: readonly string[] = [
  "core.sshCommand=",
  "core.pager=",
  "core.editor=",
  "core.fsmonitor=",
  "core.askPass=",
  "http.proxy=",
];

function hasUnsafePrefix(arg: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (arg.startsWith(prefix)) return true;
  }
  return false;
}

function isUnsafeUrlInsteadOf(arg: string): boolean {
  // Match `url.<scheme>.insteadOf=...` (git URL rewriting can smuggle in
  // ext:: transports). Use indexOf rather than a regex so CodeQL flow
  // analysis recognizes the sanitizer.
  if (!arg.startsWith("url.")) return false;
  const insteadOfIdx = arg.indexOf(".insteadOf=");
  return insteadOfIdx > 4;
}

/**
 * Run `git` with the given args in `cwd`. Never uses a shell (no injection
 * surface). Captures the exit code without throwing on a non-zero status, so
 * callers can branch on `exitCode` directly. Sanitizes argv against git
 * options that would otherwise run a subordinate command (--upload-pack,
 * --exec, -c core.sshCommand=, ext:: URLs, etc.).
 */
export async function runGit(cwd: string, args: string[]): Promise<GitExecResult> {
  const sanitized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string") {
      throw new Error("git arguments must be strings");
    }
    if (hasUnsafePrefix(arg, DANGEROUS_GIT_ARG_PREFIXES)) {
      throw new Error(`Refusing unsafe git argument: ${arg}`);
    }
    if (arg.startsWith("ext::") || arg.startsWith("ext:")) {
      throw new Error(`Refusing unsafe git ext:: URL: ${arg}`);
    }
    if (arg === "-c" || arg === "--config") {
      const next = args[i + 1];
      if (typeof next === "string") {
        if (hasUnsafePrefix(next, DANGEROUS_GIT_CONFIG_KEY_PREFIXES) || isUnsafeUrlInsteadOf(next)) {
          throw new Error(`Refusing unsafe git config override: ${next}`);
        }
      }
    }
    sanitized.push(arg);
  }
  try {
    const { stdout, stderr } = await execFileAsync("git", sanitized, {
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
