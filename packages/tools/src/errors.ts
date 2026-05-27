/** Errors surfaced by tools. `code` is stable for UI/logging. */
export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export const TOOL_CODES = {
  fileTooLarge: "FILE_TOO_LARGE",
  binaryFile: "BINARY_FILE",
  readFailed: "READ_FAILED",
  ripgrepMissing: "RIPGREP_MISSING",
  searchFailed: "SEARCH_FAILED",
  patchInvalid: "PATCH_INVALID",
  patchApplyFailed: "PATCH_APPLY_FAILED",
  fileChangedExternally: "FILE_CHANGED_EXTERNALLY",
  commandFailed: "COMMAND_FAILED",
} as const;
