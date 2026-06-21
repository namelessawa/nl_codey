/** Phase 3 Git workflow integration contracts. */

export type GitActionKind = "create_branch" | "commit" | "pr_generated";

export type GitAction = {
  id: string;
  runId: string;
  action: GitActionKind;
  /** Branch name or commit sha. */
  ref?: string;
  /** Extra JSON detail. */
  payload?: string;
  createdAt: number;
};

export type GitWorkingTreeStatus = {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  staged: string[];
  modified: string[];
  untracked: string[];
};

export type BranchCreateRequest = {
  /** Slug fragment derived from the task title. */
  slug: string;
  /** Base ref; defaults to current HEAD. */
  base?: string;
};

export type CommitRequest = {
  taskNodeId: string;
  /** Conventional-commit type, e.g. "feat", "fix". */
  type: string;
  /** Optional scope, e.g. "payment". */
  scope?: string;
  /** Summary line (no type/scope prefix). */
  summary: string;
  /** Body paragraphs. */
  body: string;
  changedFiles: string[];
  /** e.g. "pnpm test (passed in 8.2s)". */
  verifiedBy?: string;
};

export type CommitResult = {
  sha: string;
  message: string;
};

/** Per-TaskNode summary used to build the PR description. */
export type TaskChangeSummary = {
  taskNodeId: string;
  title: string;
  changedFiles: string[];
  testResult?: string;
  regressionRisk?: "low" | "medium" | "high";
};

export type PRDescriptionInput = {
  runId: string;
  userRequest: string;
  branch: string;
  tasks: TaskChangeSummary[];
  /** Overall test output. */
  testOutput?: string;
};

export type PRDescription = {
  title: string;
  /** Markdown body, truncated to PR_DESCRIPTION_MAX_CHARS. */
  body: string;
};

/** Co-author trailer attached to every agent commit. */
export const GIT_COAUTHOR_TRAILER = "Co-Authored-By: nlc <agent@local>";
/** Agent branch name prefix. */
export const GIT_AGENT_BRANCH_PREFIX = "agent/";
/** PR description hard cap. */
export const PR_DESCRIPTION_MAX_CHARS = 8000;
