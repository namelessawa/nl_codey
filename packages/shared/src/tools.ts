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

// run_command
export type RunCommandInput = { command: string; timeoutMs?: number };
export type RunCommandOutput = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export const TOOL_LIMITS = {
  maxListedFiles: 500,
  maxReadBytes: 200 * 1024,
  maxSearchResults: 100,
  maxSearchContextChars: 300,
  maxReadFilesPerRun: 8,
  commandTimeoutMs: 60_000,
  maxCommandOutputBytes: 100 * 1024,
} as const;
