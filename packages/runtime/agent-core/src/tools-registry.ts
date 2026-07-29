import type {
  LLMToolCall,
  RunCommandOutput,
  SandboxPolicy,
  ToolContext,
  ToolSchema,
} from "@nlc/shared";
import type { FileChange } from "@nlc/sandbox";
import {
  analyzeImpactTool,
  applyPatchTool,
  findSymbolTool,
  gitDiff,
  gitStatus,
  listFilesTool,
  readFileRangeTool,
  readFileTool,
  runCommandWithPolicy,
  searchTextTool,
  type SnapshotStore,
} from "@nlc/tools";
import {
  createExtendedDispatcher,
  EXTENDED_AGENT_TOOL_NAMES,
  EXTENDED_AGENT_TOOL_SCHEMAS,
  type ExtendedAgentPorts,
} from "./extended-tools.js";
import {
  MUTATING_AGENT_TOOL_NAMES,
  type MutationAuthorizationResult,
} from "./mutation-policy.js";

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
    name: "analyze_impact",
    description:
      "Analyze a TS/JS module before changing it: declarations, direct relative imports/importers, conventional tests, lexical callers, impacted modules, scan limits, and selection reason.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TypeScript/JavaScript module.",
        },
        symbol: {
          type: "string",
          description: "Optional exact symbol to focus lexical callers.",
        },
        maxResults: {
          type: "number",
          description: "Maximum graph edges to return (hard-capped at 100).",
        },
      },
      required: ["path"],
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
export const FILE_MUTATING_TOOLS: readonly string[] = ["apply_patch"];

/**
 * Union of every tool that mutates persistent state (workspace files or the
 * project memory store). Used by the read-only filter in {@link agentToolSchemas}
 * and the dispatcher in {@link createToolExecutor}. Combining these into one
 * list means a future Phase 3/4 tool can opt in by adding its name to either
 * {@link FILE_MUTATING_TOOLS} or {@link EXTENDED_MUTATING_TOOLS} without touching
 * either gate.
 */
export const ALL_MUTATING_TOOLS: readonly string[] = MUTATING_AGENT_TOOL_NAMES;

/**
 * The tool schemas advertised to the model. In read-only mode every mutating
 * tool (file writes + memory writes) is filtered out so the model never even
 * attempts a state change. Phase 3 tools (semantic_search / memory / web) are
 * appended when the caller passes {@link ExtendedAgentPorts}; without ports the
 * model only sees the Phase 1/2 catalogue, matching the pre-Phase-3 behaviour.
 *
 * `extraSchemas` allows the host to inject additional tool catalogues — most
 * notably plugin tools, but any other dynamically-loaded surface fits the
 * same shape. They're appended verbatim after Phase 3 schemas. Read-only mode
 * does NOT filter `extraSchemas`: the host is responsible for that decision
 * because mutating-ness is opaque to the agent-core layer.
 */
export function agentToolSchemas(
  options: {
    readOnly?: boolean;
    phase3Available?: boolean;
    extraSchemas?: readonly ToolSchema[];
  } = {},
): ToolSchema[] {
  const base = options.phase3Available
    ? [...AGENT_TOOL_SCHEMAS, ...EXTENDED_AGENT_TOOL_SCHEMAS]
    : [...AGENT_TOOL_SCHEMAS];
  const filtered = options.readOnly
    ? base.filter((tool) => !ALL_MUTATING_TOOLS.includes(tool.name))
    : base;
  return options.extraSchemas ? [...filtered, ...options.extraSchemas] : filtered;
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
  /**
   * Active sandbox policy for `run_command`. When mode is `docker` or `wsl`
   * commands are routed through the strong-sandbox runners; otherwise they
   * fall back to the legacy whitelist runner. Optional so existing callers
   * (tests, headless harnesses) that don't care about isolation keep working.
   */
  sandboxPolicy?: SandboxPolicy;
  /**
   * Called when an LLM-initiated `run_command` in docker/wsl mode produced
   * file writes. Must resolve `true` to sync the changes to the host
   * workspace (snapshotted for rollback) or `false` to discard. When omitted
   * the executor defaults to discarding any sandboxed writes — safe but
   * potentially surprising, so the AgentService always provides this.
   */
  requestSandboxWriteApproval?: (
    call: LLMToolCall,
    changes: FileChange[],
  ) => Promise<boolean>;
  /**
   * Optional Phase 3 port bundle. When provided, calls to semantic_search /
   * read_memory / write_memory / web_search / web_fetch are routed through the
   * corresponding port. Omit to keep the executor at the Phase 1/2 surface.
   */
  phase3Ports?: ExtendedAgentPorts;
  /**
   * Optional extra dispatcher tried before the Phase 1/2 switch. Used by the
   * plugin runtime to route `plugin__<plugin>__<tool>` calls through the
   * PluginHost (which re-validates enablement + permissions). Return null
   * when the call is not handled and the executor will fall through to its
   * built-in dispatch.
   */
  extraDispatcher?: (call: LLMToolCall, ctx: ToolContext) => Promise<ExecutedTool | null>;
  /** Dynamic mutators are host-classified and join the built-in deny set. */
  mutatingToolNames?: readonly string[];
  /**
   * Execution-time authorization for every persistent/process-capable tool.
   * AgentService supplies a single-use approval store; direct executor callers
   * must make an equally explicit policy choice.
   */
  authorizeMutation: (call: LLMToolCall) => MutationAuthorizationResult;
};

/**
 * Build a dispatcher that runs a model tool call against the Phase 1 tools.
 * Unknown tools and bad arguments yield an error result (never throw) so the
 * loop can feed the message back and let the model recover.
 */
export function createToolExecutor(
  opts: ToolExecutorOptions,
): (call: LLMToolCall) => Promise<ExecutedTool> {
  const {
    ctx,
    storage,
    allowShellExecution,
    assertToolAllowed,
    readOnly,
    sandboxPolicy,
    requestSandboxWriteApproval,
    phase3Ports,
    extraDispatcher,
    mutatingToolNames,
    authorizeMutation,
  } = opts;
  const phase3Dispatch = phase3Ports ? createExtendedDispatcher(phase3Ports) : null;
  const mutatingNames = new Set([...ALL_MUTATING_TOOLS, ...(mutatingToolNames ?? [])]);

  return async (call: LLMToolCall): Promise<ExecutedTool> => {
    // Read-only ("instruction") mode: refuse any mutating tool before it can
    // touch the workspace or memory. These tools are also stripped from the
    // advertised schema, but a model can still emit a call for a name it was
    // never offered, so we fail closed here too (defense in depth).
    if (readOnly && mutatingNames.has(call.name)) {
      return err(
        call.name,
        `Tool "${call.name}" is disabled: the agent is in read-only (query) mode and must not modify or delete files or memory. Read and explain instead — propose changes in prose for the user to apply.`,
      );
    }
    if (call.name === "run_command" && !allowShellExecution) {
      return err(
        "run_command",
        "Shell execution is disabled in settings. Ask the user to enable it, or finish without running commands.",
      );
    }
    // Installation/capability gate first, before a single-use approval is
    // consumed. A degraded-mode denial must leave the grant unusable.
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
    if (mutatingNames.has(call.name)) {
      const authorization = authorizeMutation(call);
      if (!authorization.allowed) {
        return err(call.name, `Mutation authorization denied: ${authorization.reason}`);
      }
    }
    // Phase 3 dispatch: try it first so semantic_search / read_memory /
    // write_memory / web_search / web_fetch never fall into the unknown-tool
    // branch when ports are wired. Returns null when the call is not a Phase 3
    // tool, in which case control falls through to the Phase 1/2 switch below.
    if (phase3Dispatch && (EXTENDED_AGENT_TOOL_NAMES as readonly string[]).includes(call.name)) {
      const result = await phase3Dispatch(call, ctx);
      if (result) return result;
    }
    // Extra dispatcher (plugins / future runtimes). Tried before the built-in
    // switch so a plugin can't be shadowed by a tool name collision. The
    // dispatcher returns null when it doesn't recognise the call; only then
    // do we fall through to the Phase 1/2 dispatch.
    if (extraDispatcher) {
      const handled = await extraDispatcher(call, ctx);
      if (handled) return handled;
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
        case "analyze_impact": {
          const path = stringArg(args.path);
          if (!path) return err("analyze_impact", "Missing required argument: path");
          const out = await analyzeImpactTool.run(
            {
              path,
              ...(stringArg(args.symbol) ? { symbol: stringArg(args.symbol) } : {}),
              ...(numberArg(args.maxResults) !== undefined
                ? { maxResults: numberArg(args.maxResults) }
                : {}),
            },
            ctx,
          );
          return ok("analyze_impact", JSON.stringify(out));
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
          // LLM-initiated command: any sandbox writes must go through the
          // user approval gate before they reach the real workspace. When no
          // gate is wired (test harnesses), default to "discard" so a
          // sandbox-mode test never leaks sandbox-side writes into the host.
          const writeback =
            sandboxPolicy && sandboxPolicy.mode !== "whitelist" && requestSandboxWriteApproval
              ? {
                  kind: "approve" as const,
                  onApprove: (changes: FileChange[]) =>
                    requestSandboxWriteApproval(call, changes),
                }
              : { kind: "discard" as const };
          const out = await runCommandWithPolicy({ command }, ctx, {
            ...(sandboxPolicy ? { policy: sandboxPolicy } : {}),
            writeback,
            snapshotStore: storage,
          });
          const writebackNote = describeWriteback(out.changes, out.binaryConflicts, out.applied, writeback.kind);
          return {
            name: "run_command",
            resultText: JSON.stringify({
              command: out.command,
              exitCode: out.exitCode,
              timedOut: out.timedOut,
              stdout: truncate(out.stdout),
              stderr: truncate(out.stderr),
              ...(writebackNote ? { writeback: writebackNote } : {}),
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

/**
 * Human-readable note for the model summarising what happened to the
 * sandbox's writes — applied, awaiting approval (rejected by user), discarded
 * (no gate wired), or blocked because the command produced binary output.
 * Returned as a short string the model can read alongside the command output.
 */
function describeWriteback(
  changes: FileChange[],
  binaryConflicts: { path: string; kind: string }[],
  applied: boolean,
  mode: "auto" | "approve" | "discard",
): string | null {
  if (binaryConflicts.length > 0) {
    return `${binaryConflicts.length} binary file change(s) detected; sandbox writeback refused (binary blobs are never auto-synced).`;
  }
  if (changes.length === 0) return null;
  if (applied) return `Applied ${changes.length} file change(s) to the workspace (snapshotted for rollback).`;
  if (mode === "approve") return `User rejected ${changes.length} file change(s); workspace untouched.`;
  return `Discarded ${changes.length} sandbox-side file change(s); workspace untouched.`;
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
