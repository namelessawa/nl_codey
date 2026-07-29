/** Tool system contracts. Tools are pure functions over a ToolContext. */

import type { ContextProvenance, ChunkKind } from "./semantic.js";

export type ToolContext = {
  workspaceRoot: string;
  runId: string;
  signal?: AbortSignal;
};

export type AgentTool<Input, Output> = {
  name: string;
  description: string;
  run(input: Input, ctx: ToolContext): Promise<Output>;
};

// list_files
export type ListFilesInput = { maxFiles?: number };
export type ListFilesOutput = { files: string[] };

// read_file
export type ReadFileInput = { path: string };
export type ReadFileOutput = { path: string; content: string };

// search_text
export type SearchMatch = { path: string; line: number; text: string };
export type SearchTextInput = { query: string; maxResults?: number };
export type SearchTextOutput = { query: string; matches: SearchMatch[] };

// apply_patch
export type ApplyPatchInput = { runId: string; patch: string };
export type ApplyPatchOutput = { applied: boolean; changedFiles: string[] };

// write_file (internal; only invoked after user approval)
export type WriteFileInput = { runId: string; path: string; content: string };
export type WriteFileOutput = { path: string; bytesWritten: number };

// read_file_range
export type ReadFileRangeInput = { path: string; startLine: number; endLine: number };
export type ReadFileRangeOutput = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  /** Total lines in the file, so the model knows whether to keep reading. */
  totalLines: number;
};

// git_status
export type GitStatusOutput = {
  branch: string;
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
};

// git_diff
export type GitDiffInput = { path?: string; staged?: boolean };
export type GitDiffOutput = { diff: string };

// record_plan (structured plan registration; advisory only)
export type PlanStep = {
  description: string;
  expectedFiles?: string[];
  expectedCommands?: string[];
};
export type RecordPlanInput = { steps: PlanStep[] };
export type RecordPlanOutput = { recorded: number };

// find_symbol
export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "struct"
  | "const"
  | "var";

export type SymbolInfo = {
  name: string;
  kind: SymbolKind;
  file: string;
  /** 1-indexed line of the declaration. */
  line: number;
  /** Trimmed declaration line (the signature). */
  signature: string;
  exported: boolean;
};

export type FindSymbolInput = {
  /** Symbol name to look up (exact match preferred, substring fallback). */
  name?: string;
  /** Restrict to a single file; with no name, lists all symbols in that file. */
  path?: string;
  maxResults?: number;
};
export type FindSymbolOutput = { symbols: SymbolInfo[]; truncated: boolean };

// analyze_impact
export type ImpactEdgeKind = "declares" | "imports" | "tests" | "calls";
export type ImpactConfidence = "exact" | "heuristic";
export type ImpactEdge = {
  kind: ImpactEdgeKind;
  /** Workspace-relative source module, or the target module for declarations. */
  from: string;
  /** Workspace-relative module or `module#symbol` node. */
  to: string;
  line?: number;
  symbol?: string;
  confidence: ImpactConfidence;
};
export type AnalyzeImpactInput = {
  /** Workspace-relative TypeScript/JavaScript module to analyze. */
  path: string;
  /** Optional symbol; otherwise exported callable declarations are considered. */
  symbol?: string;
  maxResults?: number;
};
export type AnalyzeImpactOutput = {
  target: string;
  coverage: "typescript-javascript";
  symbols: SymbolInfo[];
  edges: ImpactEdge[];
  /** Modules that import, test, or lexically call into the target. */
  impactedFiles: string[];
  scannedFiles: number;
  selectionReason: string;
  truncated: boolean;
  limitations: string[];
};

// run_command
export type RunCommandInput = { command: string; timeoutMs?: number };
export type RunCommandOutput = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

// parse_test_failure
export type TestFramework =
  | "vitest"
  | "jest"
  | "pytest"
  | "tsc"
  | "go-test"
  | "cargo-test"
  | "unknown";

export type TestFailureItem = {
  file: string;
  line?: number;
  column?: number;
  testName?: string;
  message: string;
  stackTrace?: string;
};

export type ParseTestFailureInput = {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
};

export type TestFailureReport = {
  framework: TestFramework;
  failures: TestFailureItem[];
  summary: string;
};

/** Max characters of raw output kept in the `summary` when parsing fails. */
export const MAX_FAILURE_SUMMARY_CHARS = 4000;

// --- Phase 3 tools ---

// semantic_search (Planner / Coder): natural-language code/doc retrieval.
export type SemanticSearchToolInput = {
  query: string;
  topK?: number;
  kinds?: ("code" | "doc" | "comment")[];
};
export type SemanticSearchToolHit = {
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  symbolName?: string;
  /** Optional for third-party ports; built-in semantic search always sets it. */
  kind?: ChunkKind;
  /** Optional for compatibility; built-in results always carry provenance. */
  provenance?: ContextProvenance;
};
export type SemanticSearchToolOutput = { query: string; hits: SemanticSearchToolHit[] };

// propose_task_breakdown (Planner): submit a TaskNode DAG.
export type ProposeTaskBreakdownInput = {
  root: string;
  tasks: {
    id: string;
    title: string;
    description: string;
    dependsOn: string[];
    verifyCommand?: string | null;
    filesScope?: string[];
  }[];
};
export type ProposeTaskBreakdownOutput = {
  accepted: boolean;
  taskCount: number;
  issues: string[];
};

// update_task_status (Coder): update the current TaskNode status.
export type UpdateTaskStatusInput = {
  taskNodeId: string;
  status: "running" | "succeeded" | "failed" | "blocked";
  note?: string;
};
export type UpdateTaskStatusOutput = { taskNodeId: string; status: string };

// request_review (Coder -> Reviewer).
export type RequestReviewInput = { taskNodeId: string; diff: string; testOutput: string };
export type RequestReviewOutput = { requested: boolean };

// approve_change (Reviewer).
export type ApproveChangeInput = { taskNodeId: string; note?: string };
export type ApproveChangeOutput = { approved: boolean };

// request_changes (Reviewer).
export type RequestChangesInput = {
  taskNodeId: string;
  comments: {
    file: string;
    line: number;
    severity: "warning" | "blocker";
    message: string;
  }[];
};
export type RequestChangesOutput = { requested: boolean };

// read_memory (all roles): retrieve project memory.
export type ReadMemoryInput = {
  query?: string;
  kind?: "decision" | "preference" | "failure" | "fact";
  maxEntries?: number;
};
export type ReadMemoryHit = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  score: number;
};
export type ReadMemoryOutput = { hits: ReadMemoryHit[] };

// write_memory (Coder, restricted to fact/decision).
export type WriteMemoryInput = {
  kind: "fact" | "decision";
  title: string;
  body: string;
  tags?: string[];
};
export type WriteMemoryOutput = { id: string; kind: string };

// web_search (Coder).
export type WebSearchToolInput = { query: string; maxResults?: number };
export type WebSearchToolResult = { title: string; url: string; snippet: string };
export type WebSearchToolOutput = { query: string; results: WebSearchToolResult[] };

// web_fetch (Coder).
export type WebFetchToolInput = { url: string };
export type WebFetchToolOutput = { url: string; text: string; truncated: boolean };

export const TOOL_LIMITS = {
  maxListedFiles: 500,
  maxReadBytes: 200 * 1024,
  maxSearchResults: 100,
  maxSearchContextChars: 300,
  maxReadFilesPerRun: 8,
  maxReadRangeLines: 500,
  commandTimeoutMs: 60_000,
  maxCommandOutputBytes: 100 * 1024,
} as const;
