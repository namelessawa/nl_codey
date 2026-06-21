/**
 * Type surface for the NLC agent loop — a deliberately three-phase ReAct
 * harness that you can drop in anywhere a `ChatLLMProvider` is available.
 *
 * The three phases mirror the contract from the design brief:
 *
 *   Phase 1 — initContext
 *     Stack: built-in system prompt → ~/.nlc/system.md → <ws>/.nlc/system.md
 *            → ~/.nlc/agents.md   → <ws>/.nlc/AGENTS.md
 *            → skills catalogue (from ~/.nlc/skills/*.md + <ws>/.nlc/skills/*.md)
 *     Then: prior history + current user message.
 *
 *   Phase 2 — transform
 *     Estimate tokens. If the running stack exceeds a fraction of the model's
 *     context window, fold the middle of history into an LLM-written summary
 *     (the existing {@link compressConversation}). Otherwise pass through.
 *
 *   Phase 3 — react
 *     Stream chat() turns, execute requested tool calls, feed results back,
 *     repeat until the model stops with no tool calls (terminal `done`), the
 *     budget trips, the caller aborts, or the model emits an error.
 *
 * Project features (approval gate, verify-after-patch, regression guard,
 * sandbox policy) are opt-in callbacks on {@link NlcLoopOptions} so the same
 * loop is usable headless (e.g. `nlc run`) or wired into the GUI's full
 * approval IPC. No SDK dependency — we go through the project's own
 * {@link ChatLLMProvider} which is implemented on plain `fetch`.
 */
import type {
  ChatLLMProvider,
  LanguagePreference,
  LLMChunk,
  LLMMessage,
  LLMToolCall,
  TokenUsage,
  ToolSchema,
} from "@nlc/shared";
import type { BudgetController } from "../budget.js";

/** Inputs that change every turn / every run. */
export type NlcLoopInput = {
  /** The user's current message (the "current message" in the design brief). */
  currentMessage: string;
  /**
   * Optional prior conversation. May include `system` messages from a
   * previous turn — Phase 1 drops them and re-derives system content from
   * the current global+project state so a reloaded run reflects today's
   * system.md / agents.md / skills.
   */
  history?: readonly LLMMessage[];
  /** Workspace root — the project we are operating on. */
  workspaceRoot: string;
};

/** Required dependencies. */
export type NlcLoopDeps = {
  /** Streaming LLM provider — `chat()` + `complete()` (the project's own). */
  llm: ChatLLMProvider;
  /**
   * Tool catalogue advertised to the model. NLC loop will additionally
   * inject an `invoke_skill` tool when skills are discovered, so callers
   * MUST NOT name their own tools `invoke_skill`.
   */
  tools: readonly ToolSchema[];
  /**
   * Execute one tool call, return the result text fed back to the model.
   * Errors thrown here are caught by Phase 3 and re-fed as a tool-result
   * envelope so a single tool failure doesn't kill the run.
   */
  executeTool: (call: LLMToolCall) => Promise<string>;
  /** Optional callbacks and tuning knobs (see {@link NlcLoopOptions}). */
  options?: NlcLoopOptions;
};

/** Everything optional — sensible defaults when omitted. */
export type NlcLoopOptions = {
  /** Hard cap on iterations / tool calls / tokens / cost. */
  budget?: BudgetController;
  /** Abort signal — checked at every iteration boundary. */
  signal?: AbortSignal;
  /** UI language (drives built-in prompt + summarisation language). */
  language?: LanguagePreference;
  /**
   * Override the global root — default `nlcRoot()` (i.e. ~/.nlc). Mostly
   * for tests; production callers should leave this undefined.
   */
  globalRoot?: string;
  /** Sampling temperature — default 0.2. */
  temperature?: number;

  /** Phase 3 streaming chunk hook (text deltas + tool calls + finish). */
  onChunk?: (chunk: LLMChunk) => void;
  /** Phase 3 per-assistant-turn hook. */
  onAssistant?: (text: string, toolCalls: LLMToolCall[], usage: TokenUsage) => void;
  /** Phase 3 per-tool-call hook (fired before execution). */
  onToolCall?: (call: LLMToolCall) => void;
  /** Phase 3 per-tool-result hook (fired after execution). */
  onToolResult?: (call: LLMToolCall, result: string) => void;

  /** Approval gate — default: every call auto-approved. */
  requiresApproval?: (call: LLMToolCall) => boolean;
  /** Resolve `false` to cancel the run. Default: always `true`. */
  waitForApproval?: (call: LLMToolCall) => Promise<boolean>;

  /**
   * Optional verifier called after a successful `apply_patch`. The string
   * it returns is appended to the conversation as a user-role message so
   * the model can repair failures (the project's verify→repair pattern).
   * A throw is caught and treated as `null` — the verifier can never trap
   * the run.
   */
  verifyAfterPatch?: (call: LLMToolCall, result: string) => Promise<string | null>;

  /**
   * Hard cap on **consecutive** `apply_patch` turns that receive verifier
   * feedback. Once the streak exceeds the cap, a single halt notice is
   * appended and further verifier feedback is suppressed until any other
   * tool call resets the streak. Default 3 (see DEFAULT_MAX_REPAIR_ATTEMPTS
   * in loop.ts). Mirrors the GUI's bounded-ReAct safety pattern.
   */
  maxRepairAttempts?: number;

  /**
   * When true, Phase 2 compression is re-checked at every Phase 3 iteration
   * head (not just once at entry). Long ReAct loops that grow context
   * mid-run get folded before the next chat() call. Default false — match
   * the explicit-three-phase contract; the GUI shim turns this on so its
   * compress-as-you-go behaviour is preserved.
   */
  compressInLoop?: boolean;

  /**
   * Fires after a successful Phase 2 compression (entry or in-loop). Use
   * to surface "compressed N messages" to the UI without polling Phase 2
   * stats.
   */
  onCompressed?: (compressedCount: number) => void;

  /**
   * Custom summariser for Phase 2. Default: an internal call to
   * `deps.llm.complete()` using the project's compression prompt.
   * Supply this to override the prompt (e.g. a different language or a
   * provider-specific override).
   */
  summarize?: (text: string) => Promise<string>;

  /** Phase 2 compression tuning. */
  compressionRatio?: number;
  contextWindow?: number;

  /**
   * Override the built-in zh/en base system prompt. Use to inject the
   * read-only flavour ({@link getReadonlySystemPrompt}) or any other
   * fixed body. The on-disk overrides (system.md, agents.md, skills)
   * still stack on top.
   */
  customBuiltinPrompt?: string;

  /**
   * Extra text appended after the Phase 1 skill catalogue. Used by the
   * GUI to inject the project's Phase 4 augmentation (global patterns +
   * style spec + fine-tune identity reminder) without coupling Phase 1
   * to the storage layer.
   */
  augmentation?: string;
};

/** Subset of {@link NlcLoopOptions} consumed by Phase 1 alone. */
export type Phase1Options = {
  language?: LanguagePreference;
  globalRoot?: string;
  customBuiltinPrompt?: string;
  augmentation?: string;
};

/** Result of Phase 1. */
export type Phase1Result = {
  messages: LLMMessage[];
  inputs: ContextInputs;
};

/** Captured input materials, surfaced for telemetry and the UI. */
export type ContextInputs = {
  /** Built-in base system prompt (resolved from the project's prompts.ts). */
  builtin: string;
  /** Optional global override loaded from ~/.nlc/system.md. */
  globalSystem: string | null;
  /** Optional project override loaded from <ws>/.nlc/system.md. */
  projectSystem: string | null;
  /** Optional global agents description from ~/.nlc/agents.md. */
  globalAgents: string | null;
  /** Optional project agents description from <ws>/.nlc/AGENTS.md or <ws>/.nlc/agents.md. */
  projectAgents: string | null;
  /** All discovered skills (global + project), in load order. */
  skills: SkillDescriptor[];
  /**
   * The augmentation text appended after the skill catalogue (Phase 4
   * hook). Empty string when none was provided.
   */
  augmentation: string;
};

/** Frontmatter + body for one skill. */
export type SkillDescriptor = {
  /** Stable invocation name (frontmatter `name` or the filename stem). */
  name: string;
  /** One-line catalogue description (frontmatter `description`). */
  description: string;
  /** Optional trigger hint (frontmatter `when_to_use`). */
  whenToUse?: string;
  /** Where the file lives. */
  source: "global" | "project";
  /** Absolute path on disk. */
  filePath: string;
  /** Body text after the frontmatter block. */
  body: string;
};

/** Result of Phase 2. */
export type Phase2Result = {
  /** Possibly-compressed conversation. */
  messages: LLMMessage[];
  /** True iff compression was applied. */
  compressed: boolean;
  /** Number of middle messages folded into the summary (0 when not compressed). */
  compressedCount: number;
  /** Token estimate before transform. */
  tokensBefore: number;
  /** Token estimate after transform. */
  tokensAfter: number;
};

/** Result of Phase 3. */
export type Phase3Result = {
  state: "done" | "failed" | "cancelled" | "budget_exceeded";
  finalText?: string;
  failureReason?: string;
  finalMessages: LLMMessage[];
  turns: number;
  toolCalls: number;
};

/** Combined outcome returned by {@link runNlcLoop}. */
export type NlcLoopOutcome = Phase3Result & {
  /** Snapshot of every input that fed Phase 1. */
  inputs: ContextInputs;
  /** Phase 2 stats (also surfaced top-level for backwards-compat callers). */
  tokensBefore: number;
  tokensAfter: number;
  compressedCount: number;
};
