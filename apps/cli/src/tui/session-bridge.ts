/**
 * Translates `AgentEvent`s into session-store appends.
 *
 * One bridge owns one *active session writer* at a time. The TUI hook
 * (`useLoop`) instantiates a bridge per workspace and routes every
 * relevant event into it before forwarding to its own reducer; the
 * bridge is the source of truth for "what's on disk", the reducer is
 * the source of truth for "what's on screen".
 *
 * Lifecycle of one task turn:
 *
 *   submit(taskText)
 *     → appendMessage(role=user)             [marks parent for the turn]
 *   ...deltas accumulate into pendingText    (no write yet — text is
 *                                             half-formed)
 *   step_added(tool_call, content)
 *     → flush assistant text (if any) +
 *       record this tool_call as a SessionToolCall on the assistant turn
 *   step_added(tool_result, content)
 *     → appendMessage(role=tool, toolCallId = synthesised id)
 *   run_updated(terminal)
 *     → flush any remaining assistant text as a final assistant message
 *
 * Why we accept low-fidelity tool ids: the AgentEvent surface only
 * exposes human-readable `step.content` strings, not the structured
 * `LLMToolCall`s. We synthesise stable per-step ids from `step.id` so
 * the assistant turn's `toolCalls[i].id` matches its corresponding
 * tool-role message's `toolCallId`. This is enough for the tree
 * builder and any future replay path that does not re-execute tools.
 */
import path from "node:path";
import {
  SessionStore,
  type LoadedSession,
  type SessionSummary,
  type SessionToolCall,
  type SessionWriter,
} from "@nlc/session";
import type { AgentEvent } from "@nlc/shared";

export type SessionBridgeOptions = {
  /** Real workspace path — used to encode the per-project folder. */
  cwd: string;
  /** `~/.nlc/agent.session/` or a test override. */
  sessionRoot: string;
  /**
   * Optional initial title for newly-created sessions; the bridge falls
   * back to the first user message preview when this is empty.
   */
  initialTitle?: string;
};

export class SessionBridge {
  readonly store: SessionStore;
  readonly cwd: string;
  readonly #initialTitle: string | undefined;

  #writer: SessionWriter | null = null;
  /** Accumulated assistant text since the last flush. */
  #pendingAssistantText = "";
  /** Tool calls collected for the in-progress assistant turn. */
  #pendingAssistantCalls: SessionToolCall[] = [];

  constructor(opts: SessionBridgeOptions) {
    this.store = new SessionStore({ root: opts.sessionRoot });
    this.cwd = opts.cwd;
    this.#initialTitle = opts.initialTitle;
  }

  /** Lazily create the active session — first call drives file creation. */
  ensureWriter(): SessionWriter {
    if (this.#writer) return this.#writer;
    this.#writer = this.store.createSession(this.cwd, {
      ...(this.#initialTitle ? { title: this.#initialTitle } : {}),
    });
    return this.#writer;
  }

  /** Active session id, or null when no writer is open yet. */
  get currentSessionId(): string | null {
    return this.#writer?.header.id ?? null;
  }

  /** Active session file path, or null. */
  get currentFilePath(): string | null {
    return this.#writer?.filePath ?? null;
  }

  /** Record a user message and pin it as the parent for the upcoming turn. */
  recordUserMessage(text: string): void {
    const writer = this.ensureWriter();
    this.#flushAssistantTurn();
    writer.appendMessage({ role: "user", content: text });
  }

  /**
   * Feed an agent emit event through the bridge. Callers are free to also
   * run their own reducer on the event — this method is intentionally
   * side-effect-only and returns nothing.
   */
  handleAgentEvent(event: AgentEvent): void {
    switch (event.kind) {
      case "delta":
        this.#pendingAssistantText += event.text;
        break;
      case "step_added": {
        const s = event.step;
        if (s.type === "tool_call") {
          // Synthesise an id we can use to link the result message.
          const synth: SessionToolCall = {
            id: s.id,
            name: extractToolName(s.content),
            args: { summary: s.content },
          };
          this.#pendingAssistantCalls.push(synth);
        } else if (s.type === "tool_result") {
          // Flush the assistant turn so the tool result hangs off it.
          this.#flushAssistantTurn();
          const writer = this.ensureWriter();
          writer.appendMessage({
            role: "tool",
            toolCallId: s.id,
            content: s.content,
          });
        } else if (s.type === "error") {
          this.#flushAssistantTurn();
          const writer = this.ensureWriter();
          writer.appendMessage({
            role: "system",
            content: `error: ${s.content}`,
          });
        }
        // diff/command/message steps are echoes of internal state; we
        // skip them to keep the conversation tree readable.
        break;
      }
      case "run_updated":
        if (isTerminalStatus(event.run.status)) {
          this.#flushAssistantTurn();
        }
        break;
      default:
        break;
    }
  }

  /** Record an arbitrary state change event (model/think/theme/workspace). */
  recordStateEvent(
    kind: "model_change" | "thinking_level_change" | "theme_change" | "workspace_change",
    from: string | { provider: string; model: string } | null,
    to: string | { provider: string; model: string },
  ): void {
    const writer = this.ensureWriter();
    if (kind === "model_change") {
      writer.appendStateEvent({
        type: "model_change",
        from: from as { provider: string; model: string } | null,
        to: to as { provider: string; model: string },
      });
      return;
    }
    writer.appendStateEvent({
      type: kind,
      from: (from as string | null) ?? null,
      to: to as string,
    });
  }

  /** List every session under this workspace, newest activity first. */
  listSessions(): SessionSummary[] {
    return this.store.listProjectSessions(this.cwd);
  }

  /** Load every session file under this workspace (for tree rendering). */
  loadAllSessions(): LoadedSession[] {
    return this.store.loadProjectSessions(this.cwd);
  }

  /**
   * Branch from `(parentSessionId, parentMessageId)` and switch the
   * bridge's active writer to the new session. The next `recordUserMessage`
   * will set its `parentId` to the branch point.
   */
  branchFrom(parentSessionId: string, parentMessageId: string): SessionWriter {
    // Flush the current turn before swapping writers so we don't lose state.
    this.#flushAssistantTurn();
    this.#writer?.close();
    this.#writer = this.store.branchSession({
      sessionId: parentSessionId,
      messageId: parentMessageId,
      cwd: this.cwd,
    });
    return this.#writer;
  }

  /** Resume an existing session file by absolute path. */
  resume(filePath: string): SessionWriter {
    this.#flushAssistantTurn();
    this.#writer?.close();
    const { writer } = this.store.resumeSession(filePath);
    this.#writer = writer;
    return writer;
  }

  /** Lookup absolute path for a session id; null when not found. */
  filePathFor(sessionId: string): string | null {
    const match = this.listSessions().find((s) => s.id === sessionId);
    return match?.filePath ?? null;
  }

  /** Close the active writer (idempotent). */
  close(): void {
    this.#flushAssistantTurn();
    this.#writer?.close();
    this.#writer = null;
  }

  #flushAssistantTurn(): void {
    const writer = this.#writer;
    if (!writer) {
      this.#pendingAssistantText = "";
      this.#pendingAssistantCalls = [];
      return;
    }
    if (this.#pendingAssistantText.length === 0 && this.#pendingAssistantCalls.length === 0) {
      return;
    }
    writer.appendMessage({
      role: "assistant",
      content: this.#pendingAssistantText,
      ...(this.#pendingAssistantCalls.length > 0
        ? { toolCalls: this.#pendingAssistantCalls }
        : {}),
    });
    this.#pendingAssistantText = "";
    this.#pendingAssistantCalls = [];
  }
}

/** Resolve the on-disk root that the bridge uses for a given data root. */
export function sessionRootFor(dataRoot: string): string {
  return path.join(dataRoot, "agent.session");
}

function extractToolName(content: string): string {
  // Step content for tool_call lines is shaped `<toolName> <summary>` in
  // service.ts. Split on the first whitespace to recover the name.
  const idx = content.search(/\s/);
  if (idx === -1) return content || "tool";
  return content.slice(0, idx) || "tool";
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "budget_exceeded"
  );
}
