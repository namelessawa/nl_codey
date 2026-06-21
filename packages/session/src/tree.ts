/**
 * Conversation-tree builder & ASCII renderer.
 *
 * A *project tree* is the union of every session file in one
 * `~/.nlc/agent.session/<encoded-cwd>/` folder, stitched together via
 * each `SessionMessage.parentId` (intra-file) and each
 * `SessionHeader.parent.messageId` (inter-file branch anchor).
 *
 * Rendering uses the same lane-allocation algorithm as `git log --graph`:
 *
 *   1) sort all messages by timestamp DESCENDING (newest first)
 *   2) walk newest → oldest, maintaining one "lane" per active branch tip
 *   3) when we render a message we set the lane's "expected next message"
 *      to its parentId
 *   4) when MULTIPLE lanes all expect the same parent, that parent is a
 *      branch point: render it in the leftmost waiting lane, then emit
 *      one merge-down (`|/`) row per remaining lane so they fold in
 *
 * Visual:
 *
 *     * msg_9   [ses_def · 14:23] user      try this instead
 *     |
 *     * msg_8   [ses_def · 14:22] assistant different approach…
 *     |
 *     | * msg_7 [ses_abc · 13:45] assistant original answer
 *     | |
 *     | * msg_6 [ses_abc · 13:40] user      that is wrong
 *     |/
 *     * msg_3   [ses_def · 12:20] user      fix the bug
 *     |
 *     * msg_2   [ses_def · 12:19] assistant hi
 *     |
 *     * msg_1   [ses_def · 12:18] user      hello
 *
 * The renderer never throws on weird input — orphan messages (parentId
 * points to a message we don't have) are treated as roots, so a
 * partially-corrupt project still produces SOMETHING readable.
 */
import type { LoadedSession, SessionMessage, SessionSummary } from "./types.js";

/** One row in the rendered tree. */
export type TreeRow =
  /** A message row. */
  | {
      kind: "node";
      message: AnnotatedMessage;
      /** Column index (0-based) the `*` sits in. */
      lane: number;
      /** Snapshot of active lanes at this row (post-render). */
      lanes: ReadonlyArray<string | null>;
      /** Pre-rendered ASCII for this row including connectors. */
      ascii: string;
    }
  /** A merge-down row (no message). */
  | {
      kind: "merge";
      from: number;
      to: number;
      lanes: ReadonlyArray<string | null>;
      ascii: string;
    };

/** Message with the session it came from attached. */
export type AnnotatedMessage = SessionMessage & {
  sessionId: string;
};

export type RenderTreeOptions = {
  /** Highlight the active session in the right-hand column. Default: undefined. */
  activeSessionId?: string;
  /** Maximum width of the trailing description column. Default: 60. */
  descriptionWidth?: number;
};

/**
 * Build a tree-render plan from every session in one project. Returns
 * the rows in top-down (newest-first) order plus a SessionSummary list
 * keyed by id so callers can re-derive the active branch.
 */
export function buildProjectTree(
  sessions: readonly LoadedSession[],
  options: RenderTreeOptions = {},
): TreeRow[] {
  const annotated = annotateMessages(sessions);
  if (annotated.length === 0) return [];

  // Newest first — ties broken by sessionId then id, so the output is
  // deterministic across re-renders.
  const sorted = [...annotated].sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
    return a.id.localeCompare(b.id);
  });

  // For each branched session, rewrite the first message's `parentId` to
  // point at the branch anchor so the lane algorithm sees the cross-file
  // connection without special-casing it.
  const byId = new Map<string, AnnotatedMessage>(sorted.map((m) => [m.id, m]));
  rewireBranchAnchors(sessions, byId);

  return layoutLanes(sorted, options);
}

/** Render the project tree to a multi-line string ready for stdout / Ink. */
export function renderProjectTree(
  sessions: readonly LoadedSession[],
  summaries: readonly SessionSummary[],
  options: RenderTreeOptions = {},
): string {
  const rows = buildProjectTree(sessions, options);
  if (rows.length === 0) {
    return formatHeader(summaries, options) + "\n  (no messages recorded yet)";
  }
  const headerBlock = formatHeader(summaries, options);
  const body = rows.map((r) => r.ascii).join("\n");
  return `${headerBlock}\n${body}`;
}

// --- internals ------------------------------------------------------------

function annotateMessages(sessions: readonly LoadedSession[]): AnnotatedMessage[] {
  const out: AnnotatedMessage[] = [];
  for (const s of sessions) {
    for (const m of s.messages) {
      out.push({ ...m, sessionId: s.header.id });
    }
  }
  return out;
}

/**
 * For each branched session, the first message in that file logically
 * descends from the branch anchor. If the on-disk record forgot to set
 * `parentId`, we patch the in-memory copy so the lane algorithm draws
 * the cross-file edge. We never write this back to disk — it's a
 * presentation-layer fix.
 */
function rewireBranchAnchors(
  sessions: readonly LoadedSession[],
  byId: Map<string, AnnotatedMessage>,
): void {
  for (const s of sessions) {
    const parent = s.header.parent;
    if (!parent) continue;
    const first = s.messages[0];
    if (!first) continue;
    if (first.parentId !== null && first.parentId !== undefined) continue;
    const anchored = byId.get(first.id);
    if (anchored) anchored.parentId = parent.messageId;
  }
}

function layoutLanes(
  ordered: readonly AnnotatedMessage[],
  options: RenderTreeOptions,
): TreeRow[] {
  // Each slot in `lanes` is either null (free) or the id of the message
  // that lane is currently waiting to render next as it walks back in
  // time. A "free" lane in the middle is preserved so already-allocated
  // lanes to its right keep their column index stable.
  const lanes: (string | null)[] = [];
  const rows: TreeRow[] = [];

  for (const msg of ordered) {
    const expecting = lanes
      .map((id, i) => ({ id, i }))
      .filter((e) => e.id === msg.id);

    let laneIdx: number;
    if (expecting.length === 0) {
      laneIdx = allocateFreeLane(lanes);
      lanes[laneIdx] = msg.id;
    } else {
      laneIdx = expecting[0]!.i;
    }

    // Render the message row at laneIdx.
    const ascii = renderNodeRow(lanes, laneIdx, msg, options);
    rows.push({
      kind: "node",
      message: msg,
      lane: laneIdx,
      lanes: [...lanes],
      ascii,
    });

    // Advance THIS lane's expectation.
    lanes[laneIdx] = msg.parentId;

    // Merge any other lanes that were also expecting this message.
    for (let k = 1; k < expecting.length; k++) {
      const idx = expecting[k]!.i;
      // Emit a merge-down row from idx → laneIdx, then free idx.
      const mergeAscii = renderMergeRow(lanes, idx, laneIdx);
      lanes[idx] = null;
      rows.push({
        kind: "merge",
        from: idx,
        to: laneIdx,
        lanes: [...lanes],
        ascii: mergeAscii,
      });
    }

    trimTrailingFreeLanes(lanes);
  }

  return rows;
}

function allocateFreeLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null);
  if (free !== -1) return free;
  lanes.push(null);
  return lanes.length - 1;
}

function trimTrailingFreeLanes(lanes: (string | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
}

function renderNodeRow(
  lanes: ReadonlyArray<string | null>,
  laneIdx: number,
  msg: AnnotatedMessage,
  options: RenderTreeOptions,
): string {
  const cols: string[] = [];
  const width = Math.max(lanes.length, laneIdx + 1);
  for (let i = 0; i < width; i++) {
    if (i === laneIdx) cols.push("*");
    else if (lanes[i]) cols.push("|");
    else cols.push(" ");
  }
  // Connector spaces between columns make the output much more readable
  // ("|"  →  "| "). We join with a single space.
  const graph = cols.join(" ");
  return `${graph}  ${formatMessageMeta(msg, options)}`;
}

function renderMergeRow(
  lanes: ReadonlyArray<string | null>,
  from: number,
  to: number,
): string {
  // We've already nulled `lanes[from]` before calling. Render with `/`
  // sliding from `from` toward `to` (always to the left in our model).
  const width = Math.max(lanes.length, from + 1, to + 1);
  const cols: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i === to) cols.push("|");
    else if (i === from) cols.push("/");
    else if (i > to && i < from) cols.push("_");
    else if (lanes[i]) cols.push("|");
    else cols.push(" ");
  }
  return cols.join(" ");
}

function formatMessageMeta(msg: AnnotatedMessage, options: RenderTreeOptions): string {
  const time = formatTime(msg.timestamp);
  const role = msg.role.padEnd(9);
  const session = options.activeSessionId === msg.sessionId
    ? `${msg.sessionId}*`
    : msg.sessionId;
  const desc = describeContent(msg, options.descriptionWidth ?? 60);
  return `${msg.id}  [${session} · ${time}] ${role} ${desc}`;
}

function describeContent(msg: AnnotatedMessage, width: number): string {
  const raw =
    msg.role === "tool" && msg.toolCallId
      ? `tool_result(${msg.toolCallId}): ${msg.content}`
      : msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0
        ? `${msg.content}  ⟶ tools: ${msg.toolCalls.map((t) => t.name).join(", ")}`
        : msg.content;
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  return flat.slice(0, Math.max(1, width - 1)) + "…";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatHeader(
  summaries: readonly SessionSummary[],
  options: RenderTreeOptions,
): string {
  if (summaries.length === 0) return "sessions\n  (none — submit a task to start one)";
  const lines: string[] = [`sessions in project (${summaries.length})`];
  const widest = summaries.reduce((n, s) => Math.max(n, s.id.length), 0);
  for (const s of summaries) {
    const marker = s.id === options.activeSessionId ? ">" : " ";
    const branchedNote = s.parent
      ? `   ↳ branched from ${s.parent.sessionId} · ${s.parent.messageId}`
      : "";
    lines.push(
      `  ${marker} ${s.id.padEnd(widest + 2)}` +
        `${s.messageCount.toString().padStart(3)} msg  ` +
        `· ${formatDateTime(s.updatedAt)}  ` +
        `· ${s.title}` +
        branchedNote,
    );
  }
  return lines.join("\n");
}

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
