/**
 * NL_Codey session persistence — types.
 *
 * A *session* is one append-only JSONL file under
 *   ~/.nlc/agent.session/<encoded-cwd>/ses_<utc>_<rand>.json
 * (path encoding rules live in `path-encoder.ts`).
 *
 * Line 1 is always a {@link SessionHeader}. Every subsequent line is a
 * {@link SessionRecord} — either a {@link StateEvent} (model swap, thinking
 * level change, theme change, etc.) or a {@link SessionMessage} (one
 * user/assistant/tool turn).
 *
 * Messages form a parent-pointer tree across one or more session files:
 * each message stores `parentId` (id of its predecessor in the
 * conversation), and a branched session's header carries
 * `parent.messageId` to mark where the branch attaches to the parent
 * session's tree. The `tree.ts` builder walks all session files in a
 * project folder and stitches the cross-file tree back together.
 *
 * Design contract:
 *  - file format is JSONL (one JSON object per line), so writes are
 *    crash-safe append-only (no rewrite-on-mutate). Extension is `.json`
 *    by user spec.
 *  - identical Record `type` discriminator: every line carries it; the
 *    reader switches on it. Unknown `type` values are skipped without
 *    failing — forward-compat for new event kinds.
 *  - all timestamps are Unix ms (Date.now()).
 */

/** Schema version of the on-disk file format. Bump on breaking changes. */
export const SESSION_FILE_VERSION = 1;

/** First line of every session file. */
export type SessionHeader = {
  type: "session";
  /** Schema version; matches {@link SESSION_FILE_VERSION} at write time. */
  version: number;
  /** Stable session id — also encoded in the filename. */
  id: string;
  /** Unix ms when the session was opened. */
  timestamp: number;
  /** Real working directory this session was created in. */
  cwd: string;
  /**
   * Optional human-readable title — the first user message preview is a
   * reasonable default but callers may rename via {@link SessionStore.setTitle}.
   */
  title?: string;
  /**
   * Set on branched sessions. `sessionId` is the parent session id, and
   * `messageId` is the message in that parent session this branch forks
   * from. The first user message of this branched session SHOULD set its
   * `parentId` to `messageId` so the tree builder can stitch the branch
   * onto the parent's chain without inspecting the header.
   */
  parent?: {
    sessionId: string;
    messageId: string;
  };
};

/** Roles supported in a session message line. */
export type SessionRole = "user" | "assistant" | "tool" | "system";

/** A tool call requested by the assistant in a message turn. */
export type SessionToolCall = {
  id: string;
  name: string;
  args: unknown;
};

/**
 * One conversation message — exactly the surface the user spec calls out
 * (`id`/`parentId`/`timestamp` + the raw role-specific payload "directly
 * JSON-concatenated").
 */
export type SessionMessage = {
  type: "message";
  /** Unique id within the project (recommended: globally unique). */
  id: string;
  /** Parent message id, or null for the very first user message of a tree root. */
  parentId: string | null;
  /** Unix ms when the message was recorded. */
  timestamp: number;
  /** Conversation role. */
  role: SessionRole;
  /**
   * Message body. Always present (possibly empty) so legacy readers that
   * read `m.content` stay valid even when `toolCalls`/`toolCallId` carry
   * the semantic payload.
   */
  content: string;
  /** Set on assistant messages that issued tool calls. */
  toolCalls?: SessionToolCall[];
  /** Set on tool-role messages — links the result to its triggering call. */
  toolCallId?: string;
};

/**
 * Global state-change event. Each variant is namespaced by `type` so the
 * reader can switch on it without inspecting payload shape. Add new kinds
 * by extending this union; older readers will skip unknown `type`s.
 */
export type StateEvent =
  | {
      type: "model_change";
      id: string;
      timestamp: number;
      from: { provider: string; model: string } | null;
      to: { provider: string; model: string };
    }
  | {
      type: "thinking_level_change";
      id: string;
      timestamp: number;
      from: string | null;
      to: string;
    }
  | {
      type: "theme_change";
      id: string;
      timestamp: number;
      from: string | null;
      to: string;
    }
  | {
      type: "workspace_change";
      id: string;
      timestamp: number;
      from: string | null;
      to: string;
    };

/** Anything that lives on a non-header line. */
export type SessionRecord = SessionMessage | StateEvent;

/** Discriminator helpers. */
export function isHeader(line: unknown): line is SessionHeader {
  return typeof line === "object" && line !== null && (line as { type?: unknown }).type === "session";
}
export function isMessage(line: unknown): line is SessionMessage {
  return typeof line === "object" && line !== null && (line as { type?: unknown }).type === "message";
}
export function isStateEvent(line: unknown): line is StateEvent {
  if (typeof line !== "object" || line === null) return false;
  const t = (line as { type?: unknown }).type;
  return (
    t === "model_change" ||
    t === "thinking_level_change" ||
    t === "theme_change" ||
    t === "workspace_change"
  );
}

/** A recoverable record-level problem found while reading append-only JSONL. */
export type SessionDiagnostic = {
  kind: "malformed_json";
  /** One-based line number in the session file. */
  line: number;
  /** True when the malformed record was an unterminated final line. */
  trailing: boolean;
};

/** Project-level diagnostic safe to surface without raw content or paths. */
export type SessionFileDiagnostic = {
  kind: "malformed_json" | "unreadable_session";
  fileName: string;
  sessionId: string | null;
  line: number | null;
  recoverable: boolean;
};

/** In-memory shape returned by {@link SessionStore.readSession}. */
export type LoadedSession = {
  header: SessionHeader;
  /** Every record line in file order — messages and state events interleaved. */
  records: SessionRecord[];
  /** Convenience: messages only, in file order. */
  messages: SessionMessage[];
  /** Convenience: state events only, in file order. */
  events: StateEvent[];
  /** Malformed records skipped while preserving the valid session content. */
  diagnostics: SessionDiagnostic[];
  /** Absolute path of the file on disk. */
  filePath: string;
};

/** Summary view used by `/sessions` listings. */
export type SessionSummary = {
  id: string;
  filePath: string;
  cwd: string;
  startedAt: number;
  /** Last message timestamp, or the header timestamp when no messages exist. */
  updatedAt: number;
  messageCount: number;
  title: string;
  parent: SessionHeader["parent"];
};
