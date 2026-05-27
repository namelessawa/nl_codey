import { listFilesTool } from "./list-files.js";
import { readFileTool } from "./read-file.js";
import { searchTextTool } from "./search-text.js";
import { runCommandTool } from "./run-command.js";

/** Read-only / non-mutating tools the agent may call autonomously. */
export const readOnlyTools = {
  list_files: listFilesTool,
  read_file: readFileTool,
  search_text: searchTextTool,
  run_command: runCommandTool,
} as const;

export type ReadOnlyToolName = keyof typeof readOnlyTools;
