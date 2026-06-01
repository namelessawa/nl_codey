import type {
  LLMToolCall,
  RunCommandOutput,
  ToolContext,
  ToolSchema,
} from "@coding-agent/shared";
import {
  applyPatchTool,
  findSymbolTool,
  gitDiff,
  gitStatus,
  listFilesTool,
  readFileRangeTool,
  readFileTool,
  runCommandTool,
  searchTextTool,
  type SnapshotStore,
} from "@coding-agent/tools";

/**
 * Tool schemas exposed to the model via the chat tool-calling API. Kept in sync
 * with {@link createToolExecutor}'s dispatch below and the shared tool input
 * types. These are the Phase 2 core tools; later steps add find_symbol etc.
 */
export const AGENT_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "list_files",
    description:
      "List files in the workspace (relative paths). Ignores node_modules/.git/build dirs. Use first to understand the project layout.",
    parameters: {
      type: "object",
      properties: {
        maxFiles: { type: "number", description: "Maximum number of files to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file by workspace-relative path. Rejects binary files and files over 200KB.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_text",
    description: "Search file contents for a string/regex (ripgrep). Returns up to 100 matches with file, line, and snippet.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex to search for." },
        maxResults: { type: "number", description: "Maximum number of matches." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a patch to the workspace. Prefer the V4A format (*** Begin Patch / *** Update File: / *** Add File: / *** Delete File: / *** End Patch) which locates edits by context; unified diff is also accepted. Requires user approval before writing. Snapshots files first so the change is reversible. Keep each patch focused on one problem.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "A V4A patch (preferred) or a unified diff." },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a whitelisted validation command (e.g. tests/build) from the workspace root. 60s timeout, output capped. Disabled unless the user enabled shell execution.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run (must be on the allow-list)." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file_range",
    description: "Read an inclusive 1-indexed line range from a text file (max 500 lines). Returns total line count.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        startLine: { type: "number", description: "1-indexed first line (inclusive)." },
        endLine: { type: "number", description: "1-indexed last line (inclusive)." },
      },
      required: ["path", "startLine", "endLine"],
      additionalProperties: false,
    },
  },
  {
    name: "find_symbol",
    description:
      "Find where a symbol (function/class/interface/type/const) is declared across the project by name, or list all symbols in a file. Faster than search_text for jumping to definitions.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Symbol name to find (exact preferred, substring fallback)." },
        path: { type: "string", description: "Restrict to one file; with no name, lists that file's symbols." },
        maxResults: { type: "number", description: "Maximum number of symbols to return." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "git_status",
    description: "Show the git working-tree status: branch and modified/added/deleted/untracked files.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "git_diff",
    description: "Show a unified diff of the working tree (or staged changes), optionally for a single path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file path to diff." },
        staged: { type: "boolean", description: "Diff staged changes instead of the working tree." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "record_plan",
    description: "Register a structured plan (advisory, for the trace). Optional — does not change files.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered plan steps.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              expectedFiles: { type: "array", items: { type: "string" } },
              expectedCommands: { type: "array", items: { type: "string" } },
            },
            required: ["description"],
          },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
];

/**
 * Tools that create, modify, or delete files in the workspace. In read-only
 * ("instruction") mode the agent is a query-only assistant: these tools are
 * stripped from the schema the model sees (see {@link agentToolSchemas}) AND
 * hard-refused at dispatch (see {@link createToolExecutor}). The dual check is
 * deliberate defense in depth — a model can emit a tool call for a name it was
 * never offered, so we must also fail closed in the executor.
 */
export const FILE_MUTATING_TOOLS: readonly string[] = ["apply_patch", "write_file"];

/**
 * The tool schemas advertised to the model. In read-only mode the file-mutating
 * tools are filtered out so the model never even attempts an edit; otherwise the
 * full {@link AGENT_TOOL_SCHEMAS} list is returned.
 */
export function agentToolSchemas(options: { readOnly?: boolean } = {}): ToolSchema[] {
  if (!options.readOnly) return AGENT_TOOL_SCHEMAS;
  return AGENT_TOOL_SCHEMAS.filter((tool) => !FILE_MUTATING_TOOLS.includes(tool.name));
}

/** Outcome of executing one tool call, with metadata for step recording/UI. */
export type ExecutedTool = {
  name: string;
  /** Serialized result fed back to the model as the tool message content. */
  resultText: string;
  isError: boolean;
  /** apply_patch: the diff that was applied. */
  patch?: string;
  /** apply_patch: files changed. */
  changedFiles?: string[];
  /** run_command: structured output. */
  command?: RunCommandOutput;
};

export type ToolExecutorOptions = {
  ctx: ToolContext;
  storage: SnapshotStore;
  allowShellExecution: boolean;
  /**
   * Optional gate consulted before every tool dispatch. Used by the
   * installation gate to refuse `run_command`/`apply_patch`/`write_file`
   * when Docker is missing and the user opted to skip the install prompt.
   *
   * The function should throw a readable Error when the tool is disallowed;
   * the executor catches it and returns a structured error result so the
   * loop can feed the failure back to the model without crashing the run.
   *
   * Optional so existing callers (tests, CLI harnesses) don't have to
   * provide it. When omitted, no extra gating is applied.
   */
  assertToolAllowed?: (toolName: string) => void;
  /**
   * Read-only ("instruction") mode. When true, any {@link FILE_MUTATING_TOOLS}
   * call is refused with a readable error before it can touch the workspace —
   * the agent becomes a query-only assistant that can never modify or delete a
   * file. Pair with {@link agentToolSchemas}`({ readOnly: true })` so the model
   * is not even offered the tool. Defaults to false (full read/write agent).
   */
  readOnly?: boolean;
};

/**
 * Build a dispatcher that runs a model tool call against the Phase 1 tools.
 * Unknown tools and bad arguments yield an error result (never throw) so the
 * loop can feed the message back and let the model recover.
 */
export function createToolExecutor(
  opts: ToolExecutorOptions,
): (call: LLMToolCall) => Promise<ExecutedTool> {
  const { ctx, storage, allowShellExecution, assertToolAllowed, readOnly } = opts;

  return async (call: LLMToolCall): Promise<ExecutedTool> => {
    // Read-only ("instruction") mode: refuse any file-mutating tool before it
    // can write or delete. These tools are also stripped from the advertised
    // schema, but a model can still emit a call for a name it was never
    // offered, so we fail closed here too (defense in depth).
    if (readOnly && FILE_MUTATING_TOOLS.includes(call.name)) {
      return err(
        call.name,
        `Tool "${call.name}" is disabled: the agent is in read-only (query) mode and must not modify or delete files. Read and explain the code instead — propose changes in prose for the user to apply.`,
      );
    }
    // Installation-gate check FIRST — refuse before we touch the workspace.
    // Catch + return-error keeps the loop alive: the model sees the failure
    // and can either stop or pick a different tool.
    if (assertToolAllowed) {
      try {
        assertToolAllowed(call.name);
      } catch (gateErr) {
        return err(
          call.name,
          gateErr instanceof Error ? gateErr.message : String(gateErr),
        );
      }
    }
    const args = isRecord(call.args) ? call.args : {};
    try {
      switch (call.name) {
        case "list_files": {
          const out = await listFilesTool.run({ maxFiles: numberArg(args.maxFiles) }, ctx);
          return ok("list_files", JSON.stringify({ files: out.files, count: out.files.length }));
        }
        case "read_file": {
          const path = stringArg(args.path);
          if (!path) return err("read_file", "Missing required argument: path");
          const out = await readFileTool.run({ path }, ctx);
          return ok("read_file", JSON.stringify({ path: out.path, content: out.content }));
        }
        case "search_text": {
          const query = stringArg(args.query);
          if (!query) return err("search_text", "Missing required argument: query");
          const out = await searchTextTool.run({ query, maxResults: numberArg(args.maxResults) }, ctx);
          return ok("search_text", JSON.stringify({ query: out.query, matches: out.matches }));
        }
        case "apply_patch": {
          const patch = stringArg(args.patch);
          if (!patch) return err("apply_patch", "Missing required argument: patch");
          const out = await applyPatchTool({ runId: ctx.runId, patch }, ctx, storage);
          return {
            name: "apply_patch",
            resultText: JSON.stringify({ applied: out.applied, changedFiles: out.changedFiles }),
            isError: false,
            patch,
            changedFiles: out.changedFiles,
          };
        }
        case "read_file_range": {
          const path = stringArg(args.path);
          const startLine = numberArg(args.startLine);
          const endLine = numberArg(args.endLine);
          if (!path || startLine === undefined || endLine === undefined) {
            return err("read_file_range", "Requires path, startLine, and endLine");
          }
          const out = await readFileRangeTool.run({ path, startLine, endLine }, ctx);
          return ok("read_file_range", JSON.stringify(out));
        }
        case "find_symbol": {
          const out = await findSymbolTool.run(
            {
              ...(stringArg(args.name) ? { name: stringArg(args.name) } : {}),
              ...(stringArg(args.path) ? { path: stringArg(args.path) } : {}),
              ...(numberArg(args.maxResults) !== undefined ? { maxResults: numberArg(args.maxResults) } : {}),
            },
            ctx,
          );
          return ok("find_symbol", JSON.stringify(out));
        }
        case "git_status": {
          const out = await gitStatus(ctx);
          return ok("git_status", JSON.stringify(out));
        }
        case "git_diff": {
          const out = await gitDiff(
            { ...(stringArg(args.path) ? { path: stringArg(args.path) } : {}), staged: args.staged === true },
            ctx,
          );
          return ok("git_diff", JSON.stringify({ diff: truncate(out.diff) }));
        }
        case "record_plan": {
          const steps = Array.isArray(args.steps) ? args.steps.length : 0;
          return ok("record_plan", JSON.stringify({ recorded: steps }));
        }
        case "run_command": {
          const command = stringArg(args.command);
          if (!command) return err("run_command", "Missing required argument: command");
          if (!allowShellExecution) {
            return err(
              "run_command",
              "Shell execution is disabled in settings. Ask the user to enable it, or finish without running commands.",
            );
          }
          const out = await runCommandTool.run({ command }, ctx);
          return {
            name: "run_command",
            resultText: JSON.stringify({
              command: out.command,
              exitCode: out.exitCode,
              timedOut: out.timedOut,
              stdout: truncate(out.stdout),
              stderr: truncate(out.stderr),
            }),
            isError: out.exitCode !== 0 || out.timedOut,
            command: out,
          };
        }
        default:
          return err(call.name, `Unknown tool: ${call.name}`);
      }
    } catch (e) {
      return err(call.name, e instanceof Error ? e.message : String(e));
    }
  };
}

const MAX_TOOL_RESULT_OUTPUT = 8000;

function truncate(text: string): string {
  return text.length > MAX_TOOL_RESULT_OUTPUT
    ? `${text.slice(0, MAX_TOOL_RESULT_OUTPUT)}…(truncated)`
    : text;
}

function ok(name: string, resultText: string): ExecutedTool {
  return { name, resultText, isError: false };
}

function err(name: string, message: string): ExecutedTool {
  return { name, resultText: JSON.stringify({ error: message }), isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
