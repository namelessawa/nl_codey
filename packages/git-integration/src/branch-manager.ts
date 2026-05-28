import {
  type BranchCreateRequest,
  type GitWorkingTreeStatus,
  GIT_AGENT_BRANCH_PREFIX,
} from "@coding-agent/shared";
import { runGit } from "./git-exec.js";

/** Max length of a generated slug fragment. */
const MAX_SLUG_LENGTH = 40;

/**
 * Convert a task title into a kebab-case ascii slug, capped at ~40 chars.
 * Diacritics and non-ascii characters are dropped; runs of separators
 * collapse to a single dash.
 */
export function slugify(title: string): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const kebab = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const capped = kebab.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return capped || "task";
}

/** Build a deterministic agent branch name: `agent/<slug>-<ts>`. */
export function agentBranchName(slug: string, ts: number = Date.now()): string {
  const safeSlug = slug ? slugify(slug) : "task";
  return `${GIT_AGENT_BRANCH_PREFIX}${safeSlug}-${ts}`;
}

/**
 * Parse `git status --porcelain=v1 --branch` into a structured status object,
 * collecting staged, modified, and untracked paths plus ahead/behind counts.
 */
export async function getWorkingTreeStatus(cwd: string): Promise<GitWorkingTreeStatus> {
  const result = await runGit(cwd, ["status", "--porcelain=v1", "--branch"]);
  if (result.exitCode !== 0) {
    throw new Error(`git status failed: ${result.stderr.trim() || "unknown error"}`);
  }
  return parseStatus(result.stdout);
}

function parseStatus(stdout: string): GitWorkingTreeStatus {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  let branch = "HEAD";
  let ahead = 0;
  let behind = 0;
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const parsed = parseBranchLine(line.slice(3));
      branch = parsed.branch;
      ahead = parsed.ahead;
      behind = parsed.behind;
      continue;
    }
    classifyEntry(line, staged, modified, untracked);
  }

  const clean = staged.length === 0 && modified.length === 0 && untracked.length === 0;
  return { branch, clean, ahead, behind, staged, modified, untracked };
}

function parseBranchLine(rest: string): { branch: string; ahead: number; behind: number } {
  // Forms: "main", "main...origin/main", "main...origin/main [ahead 1, behind 2]",
  // or "No commits yet on main".
  const noCommits = rest.match(/^No commits yet on (.+)$/);
  if (noCommits && noCommits[1]) {
    return { branch: noCommits[1].trim(), ahead: 0, behind: 0 };
  }
  const branch = (rest.split("...")[0] ?? rest).trim();
  const ahead = Number(rest.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(rest.match(/behind (\d+)/)?.[1] ?? 0);
  return { branch, ahead, behind };
}

function classifyEntry(
  line: string,
  staged: string[],
  modified: string[],
  untracked: string[],
): void {
  const x = line[0] ?? " ";
  const y = line[1] ?? " ";
  const path = line.slice(3);
  if (x === "?" && y === "?") {
    untracked.push(path);
    return;
  }
  // Index (staged) column.
  if (x !== " " && x !== "?") {
    staged.push(path);
  }
  // Working-tree (unstaged) column.
  if (y !== " " && y !== "?") {
    modified.push(path);
  }
}

/**
 * Create and checkout a fresh agent branch off `req.base` (or current HEAD).
 * Requires a clean working tree and throws a clear error if it is dirty, so
 * uncommitted work is never silently carried onto the new branch.
 */
export async function createAgentBranch(
  cwd: string,
  req: BranchCreateRequest,
): Promise<string> {
  const status = await getWorkingTreeStatus(cwd);
  if (!status.clean) {
    throw new Error(
      "Working tree is not clean; commit or stash changes before creating an agent branch.",
    );
  }

  const branch = agentBranchName(req.slug);
  const args = req.base
    ? ["checkout", "-b", branch, req.base]
    : ["checkout", "-b", branch];
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to create branch "${branch}": ${result.stderr.trim() || "unknown error"}`,
    );
  }
  return branch;
}

/**
 * Switch back to `base` and delete the agent branch. Guards against deleting
 * anything outside the `agent/` namespace.
 */
export async function discardAgentBranch(
  cwd: string,
  branch: string,
  base: string,
): Promise<void> {
  if (!branch.startsWith(GIT_AGENT_BRANCH_PREFIX)) {
    throw new Error(
      `Refusing to delete "${branch}": only ${GIT_AGENT_BRANCH_PREFIX}* branches may be discarded.`,
    );
  }

  const checkout = await runGit(cwd, ["checkout", base]);
  if (checkout.exitCode !== 0) {
    throw new Error(
      `Failed to checkout base "${base}": ${checkout.stderr.trim() || "unknown error"}`,
    );
  }

  const del = await runGit(cwd, ["branch", "-D", branch]);
  if (del.exitCode !== 0) {
    throw new Error(
      `Failed to delete branch "${branch}": ${del.stderr.trim() || "unknown error"}`,
    );
  }
}
