import type {
  LLMToolCall,
  RunCommandOutput,
  ToolContext,
  ToolSchema,
} from "@coding-agent/shared";
import {
  applyPatchTool,
  listFilesTool,
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
      "Apply a unified diff to the workspace. Requires user approval before writing. Snapshots files first so the change is reversible. Keep each patch focused on one problem.",
    parameters: {
      type: "object",
      properties: {
        patch: { type: "string", description: "A unified diff (git-style) to apply." },
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
];

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
};

/**
 * Build a dispatcher that runs a model tool call against the Phase 1 tools.
 * Unknown tools and bad arguments yield an error result (never throw) so the
 * loop can feed the message back and let the model recover.
 */
export function createToolExecutor(
  opts: ToolExecutorOptions,
): (call: LLMToolCall) => Promise<ExecutedTool> {
  const { ctx, storage, allowShellExecution } = opts;

  return async (call: LLMToolCall): Promise<ExecutedTool> => {
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
