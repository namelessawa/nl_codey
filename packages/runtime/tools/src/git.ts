import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitDiffInput,
  GitDiffOutput,
  GitStatusOutput,
  ToolContext,
} from "@nlc/shared";
import { TOOL_CODES, ToolError } from "./errors.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

/** Parse `git status --porcelain -b` output into categorized file lists. */
export function parseGitStatus(porcelain: string): GitStatusOutput {
  const result: GitStatusOutput = {
    branch: "",
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
  };
  for (const line of porcelain.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith("## ")) {
      // e.g. "## main...origin/main [ahead 1]" or "## HEAD (no branch)"
      result.branch = (line.slice(3).split("...")[0] ?? "").split(" ")[0] ?? "";
      continue;
    }
    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    const file = line.slice(3).trim();
    if (!file) continue;
    if (x === "?" && y === "?") {
      result.untracked.push(file);
    } else if (x === "A" || y === "A") {
      result.added.push(file);
    } else if (x === "D" || y === "D") {
      result.deleted.push(file);
    } else {
      result.modified.push(file); // M, R, C, T, and mixed states
    }
  }
  return result;
}

/** Working-tree status. Throws a readable error when not a git repository. */
export async function gitStatus(ctx: ToolContext): Promise<GitStatusOutput> {
  const { stdout } = await execGit(["status", "--porcelain", "-b"], ctx.workspaceRoot);
  return parseGitStatus(stdout);
}

/** Unified diff of the working tree (or staged changes), optionally for one path. */
export async function gitDiff(input: GitDiffInput, ctx: ToolContext): Promise<GitDiffOutput> {
  const args = ["diff"];
  if (input.staged) args.push("--cached");
  if (input.path) args.push("--", input.path);
  const { stdout } = await execGit(args, ctx.workspaceRoot);
  return { diff: stdout };
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string }> {
  try {
    const { stdout } = await run("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
    });
    return { stdout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ToolError(
      TOOL_CODES.commandFailed,
      `git ${args.join(" ")} failed (is this a git repository, and is git installed?): ${message}`,
    );
  }
}
