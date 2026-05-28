import { listFilesTool } from "./list-files.js";
import { readFileTool } from "./read-file.js";
import { searchTextTool } from "./search-text.js";
import { runCommandTool } from "./run-command.js";
import { createSemanticSearchTool } from "./semantic-search-tool.js";
import {
  createProposeTaskBreakdownTool,
  createUpdateTaskStatusTool,
} from "./task-tools.js";
import {
  createApproveChangeTool,
  createRequestChangesTool,
  createRequestReviewTool,
} from "./review-tools.js";
import { createReadMemoryTool, createWriteMemoryTool } from "./memory-tools.js";
import { createWebSearchTool, createWebFetchTool } from "./web-tools.js";
import type {
  MemoryPort,
  ReviewPort,
  SemanticSearchPort,
  TaskPort,
  WebPort,
} from "./phase3-deps.js";

/** Read-only / non-mutating tools the agent may call autonomously. */
export const readOnlyTools = {
  list_files: listFilesTool,
  read_file: readFileTool,
  search_text: searchTextTool,
  run_command: runCommandTool,
} as const;

export type ReadOnlyToolName = keyof typeof readOnlyTools;

/** Concrete service ports the Phase 3 tools are wired against. */
export interface Phase3Deps {
  semanticSearch: SemanticSearchPort;
  memory: MemoryPort;
  task: TaskPort;
  review: ReviewPort;
  web: WebPort;
}

/**
 * Assemble the Phase 3 LLM tools from injected service ports, keyed by tool
 * name. git_create_branch / git_commit are intentionally excluded — they are
 * orchestrator-driven system calls, not LLM tools.
 */
export function createPhase3Tools(deps: Phase3Deps) {
  return {
    semantic_search: createSemanticSearchTool(deps.semanticSearch),
    propose_task_breakdown: createProposeTaskBreakdownTool(deps.task),
    update_task_status: createUpdateTaskStatusTool(deps.task),
    request_review: createRequestReviewTool(deps.review),
    approve_change: createApproveChangeTool(deps.review),
    request_changes: createRequestChangesTool(deps.review),
    read_memory: createReadMemoryTool(deps.memory),
    write_memory: createWriteMemoryTool(deps.memory),
    web_search: createWebSearchTool(deps.web),
    web_fetch: createWebFetchTool(deps.web),
  } as const;
}
