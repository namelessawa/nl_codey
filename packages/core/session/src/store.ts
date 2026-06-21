/**
 * File-backed session store. Owns the on-disk layout
 *   <root>/<encoded-cwd>/ses_<utc>_<rand>.json
 * and provides:
 *
 *  - {@link SessionStore.createSession}  — open a NEW session file
 *  - {@link SessionStore.openSession}    — load an existing one into memory
 *  - {@link SessionStore.listProjectSessions} — directory scan
 *  - {@link SessionStore.branchSession}  — fork a NEW session anchored at
 *    a message in an existing one (parent header populated; first new
 *    user message MUST set parentId = branch point)
 *  - {@link SessionWriter} returned by createSession/openSession — append
 *    messages and state events one line at a time
 *
 * Writes are append-only: every `appendMessage`/`appendStateEvent` call
 * does ONE `fs.appendFileSync` with a single JSON line. A truncated
 * trailing line caused by a crash mid-write is simply ignored by the
 * reader (`safeParseLine` returns `null` for malformed JSON) — the rest
 * of the file is still recoverable.
 */
import fs from "node:fs";
import path from "node:path";
import { encodeProjectFolder } from "./path-encoder.js";
import { newEventId, newMessageId, newSessionId } from "./ids.js";
import {
  SESSION_FILE_VERSION,
  isHeader,
  isMessage,
  isStateEvent,
  type LoadedSession,
  type SessionHeader,
  type SessionMessage,
  type SessionRecord,
  type SessionRole,
  type SessionSummary,
  type SessionToolCall,
  type StateEvent,
} from "./types.js";

/** Constructor options for {@link SessionStore}. */
export type SessionStoreOptions = {
  /**
   * Root directory under which `<encoded-cwd>/` folders live. Typically
   * `path.join(nlcRoot(), "agent.session")`. Created on demand.
   */
  root: string;
  /** Optional clock injection for deterministic tests. */
  now?: () => number;
};

/** Inputs for {@link SessionWriter.appendMessage}. */
export type AppendMessageInput = {
  /** Defaults to the writer's `lastMessageId` — the head of the active chain. */
  parentId?: string | null;
  role: SessionRole;
  content: string;
  toolCalls?: SessionToolCall[];
  toolCallId?: string;
  /** Defaults to `Date.now()` (or the injected clock). */
  timestamp?: number;
  /** Defaults to a fresh `msg_<hex>`. Use when replaying. */
  id?: string;
};

/** Inputs for {@link SessionWriter.appendStateEvent}. */
export type AppendStateEventInput =
  | {
      type: "model_change";
      from: { provider: string; model: string } | null;
      to: { provider: string; model: string };
      timestamp?: number;
    }
  | {
      type: "thinking_level_change";
      from: string | null;
      to: string;
      timestamp?: number;
    }
  | {
      type: "theme_change";
      from: string | null;
      to: string;
      timestamp?: number;
    }
  | {
      type: "workspace_change";
      from: string | null;
      to: string;
      timestamp?: number;
    };

/** A live append-only handle for one session file. */
export class SessionWriter {
  /** Header committed to disk; never rewritten. */
  readonly header: SessionHeader;
  /** Absolute path on disk. */
  readonly filePath: string;

  /**
   * Id of the most recently appended *message* (not state event). Defaults
   * to the parent message id on a branched session so the first new
   * message hooks onto the parent tree automatically.
   */
  #lastMessageId: string | null;
  #now: () => number;
  #closed = false;

  constructor(filePath: string, header: SessionHeader, lastMessageId: string | null, now: () => number) {
    this.filePath = filePath;
    this.header = header;
    this.#lastMessageId = lastMessageId;
    this.#now = now;
  }

  /** The id the NEXT appended message will use as parent unless overridden. */
  get lastMessageId(): string | null {
    return this.#lastMessageId;
  }

  /** Append one message line and return the in-memory record. */
  appendMessage(input: AppendMessageInput): SessionMessage {
    this.#assertOpen();
    const id = input.id ?? newMessageId();
    const parentId = input.parentId === undefined ? this.#lastMessageId : input.parentId;
    const record: SessionMessage = {
      type: "message",
      id,
      parentId,
      timestamp: input.timestamp ?? this.#now(),
      role: input.role,
      content: input.content,
    };
    if (input.toolCalls && input.toolCalls.length > 0) record.toolCalls = input.toolCalls;
    if (typeof input.toolCallId === "string") record.toolCallId = input.toolCallId;
    appendLine(this.filePath, record);
    this.#lastMessageId = id;
    return record;
  }

  /** Append one state-change event. State events are NOT part of the parent chain. */
  appendStateEvent(input: AppendStateEventInput): StateEvent {
    this.#assertOpen();
    const ts = input.timestamp ?? this.#now();
    const id = newEventId();
    let record: StateEvent;
    switch (input.type) {
      case "model_change":
        record = { type: "model_change", id, timestamp: ts, from: input.from, to: input.to };
        break;
      case "thinking_level_change":
        record = { type: "thinking_level_change", id, timestamp: ts, from: input.from, to: input.to };
        break;
      case "theme_change":
        record = { type: "theme_change", id, timestamp: ts, from: input.from, to: input.to };
        break;
      case "workspace_change":
        record = { type: "workspace_change", id, timestamp: ts, from: input.from, to: input.to };
        break;
    }
    appendLine(this.filePath, record);
    return record;
  }

  /** Manually pin the parent for the next appendMessage call. */
  setLastMessageId(id: string | null): void {
    this.#lastMessageId = id;
  }

  /**
   * Mark this writer closed. Idempotent. Subsequent append calls will
   * throw; nothing is flushed because every append is sync-fsynced
   * by the OS through appendFileSync's underlying write+close cycle.
   */
  close(): void {
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`SessionWriter for ${this.filePath} is closed`);
  }
}

/** The file-system facade. */
export class SessionStore {
  readonly root: string;
  readonly #now: () => number;

  constructor(opts: SessionStoreOptions) {
    this.root = path.resolve(opts.root);
    this.#now = opts.now ?? (() => Date.now());
  }

  /** Absolute path to the per-project folder for a cwd. Folder is NOT created. */
  projectFolder(cwd: string): string {
    return path.join(this.root, encodeProjectFolder(cwd));
  }

  /** Create a brand-new session for `cwd`. Returns an open writer. */
  createSession(cwd: string, init?: { title?: string }): SessionWriter {
    const folder = this.projectFolder(cwd);
    fs.mkdirSync(folder, { recursive: true });
    const id = newSessionId(this.#now);
    const filePath = path.join(folder, `${id}.json`);
    const header: SessionHeader = {
      type: "session",
      version: SESSION_FILE_VERSION,
      id,
      timestamp: this.#now(),
      cwd,
    };
    if (init?.title) header.title = init.title;
    appendLine(filePath, header);
    return new SessionWriter(filePath, header, null, this.#now);
  }

  /**
   * Branch from an existing session at `branchFromMessageId`. The new
   * session's header records the parent linkage; the writer is primed so
   * the next `appendMessage` defaults `parentId` to the branch point.
   */
  branchSession(parent: { sessionId: string; messageId: string; cwd: string }, init?: { title?: string }): SessionWriter {
    // Sanity check the branch point exists; surface a readable error if not.
    const parentSummary = this.listProjectSessions(parent.cwd).find((s) => s.id === parent.sessionId);
    if (!parentSummary) {
      throw new Error(`branchSession: parent session "${parent.sessionId}" not found under ${parent.cwd}`);
    }
    const loaded = this.openSession(parentSummary.filePath);
    const branchPoint = loaded.messages.find((m) => m.id === parent.messageId);
    if (!branchPoint) {
      throw new Error(
        `branchSession: message "${parent.messageId}" not found in session "${parent.sessionId}"`,
      );
    }

    const folder = this.projectFolder(parent.cwd);
    fs.mkdirSync(folder, { recursive: true });
    const id = newSessionId(this.#now);
    const filePath = path.join(folder, `${id}.json`);
    const header: SessionHeader = {
      type: "session",
      version: SESSION_FILE_VERSION,
      id,
      timestamp: this.#now(),
      cwd: parent.cwd,
      parent: { sessionId: parent.sessionId, messageId: parent.messageId },
    };
    if (init?.title) header.title = init.title;
    appendLine(filePath, header);
    return new SessionWriter(filePath, header, parent.messageId, this.#now);
  }

  /**
   * Re-open an existing session for appending. Reads the file once to find
   * the head of the message chain, then returns a writer primed at that
   * head. Returns the loaded view as the second tuple element for callers
   * that need to replay history immediately.
   */
  resumeSession(filePath: string): { writer: SessionWriter; loaded: LoadedSession } {
    const loaded = this.openSession(filePath);
    const head = loaded.messages.length > 0 ? loaded.messages[loaded.messages.length - 1]!.id : null;
    const writer = new SessionWriter(filePath, loaded.header, head, this.#now);
    return { writer, loaded };
  }

  /** Load a session file fully into memory. Throws on missing/invalid header. */
  openSession(filePath: string): LoadedSession {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    let header: SessionHeader | null = null;
    const records: SessionRecord[] = [];
    const messages: SessionMessage[] = [];
    const events: StateEvent[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      const parsed = safeParseLine(line);
      if (parsed === null) continue;
      if (isHeader(parsed)) {
        if (header === null) header = parsed;
        continue;
      }
      if (isMessage(parsed)) {
        records.push(parsed);
        messages.push(parsed);
        continue;
      }
      if (isStateEvent(parsed)) {
        records.push(parsed);
        events.push(parsed);
        continue;
      }
      // Unknown discriminator — silently skip (forward-compat).
    }
    if (header === null) {
      throw new Error(`openSession: ${filePath} is missing a "session" header line`);
    }
    return { header, records, messages, events, filePath };
  }

  /**
   * List every session in `cwd`'s project folder, sorted by most-recent
   * activity (`updatedAt`) first. Empty array when the folder doesn't
   * exist yet — calling this on a brand-new project does NOT throw.
   */
  listProjectSessions(cwd: string): SessionSummary[] {
    const folder = this.projectFolder(cwd);
    if (!fs.existsSync(folder)) return [];
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    const summaries: SessionSummary[] = [];
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
      const filePath = path.join(folder, ent.name);
      try {
        const loaded = this.openSession(filePath);
        const last = loaded.messages[loaded.messages.length - 1];
        const first = loaded.messages[0];
        const summary: SessionSummary = {
          id: loaded.header.id,
          filePath,
          cwd: loaded.header.cwd,
          startedAt: loaded.header.timestamp,
          updatedAt: last ? last.timestamp : loaded.header.timestamp,
          messageCount: loaded.messages.length,
          title:
            loaded.header.title ??
            (first ? deriveTitleFromMessage(first.content) : "(empty)"),
          parent: loaded.header.parent,
        };
        summaries.push(summary);
      } catch {
        // Skip unreadable files (truncated header, etc.) — surface in /tree as missing.
      }
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);
    return summaries;
  }

  /**
   * Load all sessions in a project as `LoadedSession`s, in
   * most-recent-activity-first order. Used by the tree builder.
   */
  loadProjectSessions(cwd: string): LoadedSession[] {
    return this.listProjectSessions(cwd).map((s) => this.openSession(s.filePath));
  }
}

// --- internals ------------------------------------------------------------

function appendLine(filePath: string, record: object): void {
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function safeParseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function deriveTitleFromMessage(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return "(empty)";
  const max = 64;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + "…";
}
