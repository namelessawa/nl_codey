/** Tool system contracts. Tools are pure functions over a ToolContext. */

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
