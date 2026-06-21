export { runGit, isGitRepo, type GitExecResult } from "./git-exec.js";
export {
  slugify,
  agentBranchName,
  getWorkingTreeStatus,
  createAgentBranch,
  discardAgentBranch,
} from "./branch-manager.js";
export {
  buildCommitMessage,
  generateCommitMessage,
  parseCommitFields,
  commit,
  type GenerateFn,
  type CommitGenerationInput,
} from "./commit-writer.js";
export {
  parseChangedFiles,
  summarizeDiff,
  type DiffSummary,
} from "./diff-summarizer.js";
export { buildPRDescription, aggregateRisk } from "./pr-generator.js";
