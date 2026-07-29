export { listFilesTool } from "./list-files.js";
export { readFileTool } from "./read-file.js";
export { searchTextTool } from "./search-text.js";
export { runCommandTool } from "./run-command.js";
export { runCommandWithPolicy, defaultDockerImage } from "./run-command-routed.js";
export { applyPatchTool } from "./apply-patch.js";
export { writeFileTool } from "./write-file.js";
export { parseTestFailure } from "./parse-test-failure.js";
export { readFileRangeTool } from "./read-file-range.js";
export { findSymbolTool, extractSymbols } from "./symbols.js";
export { analyzeImpactTool } from "./impact.js";
export { gitStatus, gitDiff, parseGitStatus } from "./git.js";
export { isV4APatch, parseV4A, applyV4AHunks, type V4AOp, type V4AHunk } from "./v4a.js";
export { readOnlyTools, type ReadOnlyToolName, createPhase3Tools } from "./registry.js";
export { ToolError, TOOL_CODES } from "./errors.js";
export type { SnapshotStore } from "./deps.js";

// --- Phase 3 tools (factory functions over injected ports) ---
export { createSemanticSearchTool } from "./semantic-search-tool.js";
export { createProposeTaskBreakdownTool, createUpdateTaskStatusTool } from "./task-tools.js";
export {
  createRequestReviewTool,
  createApproveChangeTool,
  createRequestChangesTool,
} from "./review-tools.js";
export { createReadMemoryTool, createWriteMemoryTool } from "./memory-tools.js";
export { createWebSearchTool, createWebFetchTool } from "./web-tools.js";
export type {
  SemanticSearchPort,
  MemoryPort,
  TaskPort,
  ReviewPort,
  WebPort,
} from "./tool-ports.js";

// NOTE: git_create_branch and git_commit are NOT exposed as LLM AgentTools.
// Per the Phase 3 spec they are system calls the Orchestrator invokes directly
// at TaskNode boundaries; their I/O types live in @nlc/shared.
