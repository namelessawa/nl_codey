import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentRunDetail,
  AgentRunState,
  AgentStep,
  Workspace,
} from "@coding-agent/shared";
import { isRunActive } from "@coding-agent/shared";
import { Markdown } from "./Markdown.js";
import { Icon } from "./Icons.js";
import { useT } from "../lang-context.js";

interface ChatRunViewProps {
  detail: AgentRunDetail;
  workspace: Workspace | null;
  liveText: string;
  composerValue: string;
  composerBusy: boolean;
  /** 2-letter avatar text shown on user messages (lowercase). */
  userInitials: string;
  /** Hard cap on auto-steps, shown as "Auto · N steps" in the composer chrome. */
  maxAutoSteps: number;
  onComposerChange: (value: string) => void;
  onSubmitComposer: () => void;
  onStopRun: () => void;
  onOpenApproval: () => void;
  onRejectPatch: () => void;
  onRollback: () => void;
}

interface ChatEntry {
  key: string;
  kind: "user" | "agent" | "tool" | "error";
  text?: string;
  /** Step createdAt timestamp (ms epoch). Rendered as elapsed-from-run-start. */
  at?: number;
  tool?: { name: string; arg: string; body: string; state: "run" | "done" | "failed" };
}

export function ChatRunView({
  detail,
  workspace,
  liveText,
  composerValue,
  composerBusy,
  userInitials,
  maxAutoSteps,
  onComposerChange,
  onSubmitComposer,
  onStopRun,
  onOpenApproval,
  onRejectPatch,
  onRollback,
}: ChatRunViewProps): JSX.Element {
  const tr = useT();
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const runStartedAt = detail.run.createdAt;
  const entries = useMemo(
    () => buildEntries(detail.run.userTask, detail.steps, runStartedAt),
    [detail.run.userTask, detail.steps, runStartedAt],
  );
  const pipeline = useMemo(() => buildPipeline(detail), [detail]);
  const isActive = isRunActive(detail.run.status);
  const isWaiting = detail.run.status === "waiting_for_user_approval";
  const isDone = detail.run.status === "done";
  const isFailed =
    detail.run.status === "failed" || detail.run.status === "budget_exceeded";
  const isCancelled = detail.run.status === "cancelled";
  const hasPendingPatch = Boolean(detail.pendingPatch);

  useEffect(() => {
    const scroller = streamRef.current;
    if (!scroller) return;
    const onScroll = (): void => {
      const distanceFromBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickToBottom.current = distanceFromBottom <= 64;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [entries.length, liveText]);

  const elapsedLabel = formatElapsed(detail.run.createdAt, detail.run.updatedAt);
  const wsName = workspace ? workspaceName(workspace.rootPath) : "";

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="title-block">
          <h1>{detail.run.userTask || tr("threads.untitled")}</h1>
          <div className="crumbs">
            {wsName && <span>{wsName}</span>}
            {wsName && <span>·</span>}
            <span>
              {tr("topbar.runHash")} {shortRunId(detail.run.id)}
            </span>
            <span>·</span>
            <span>{elapsedLabel}</span>
            {detail.run.modelName && (
              <>
                <span>·</span>
                <span>{detail.run.modelName}</span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          <StatusPill status={detail.run.status} />
          {isActive && (
            <button className="btn" type="button" onClick={onStopRun} title={tr("chat.stop")}>
              <Icon name="stop" size={13} /> {tr("chat.stop")}
            </button>
          )}
          {isDone && (
            <button
              className="btn"
              type="button"
              onClick={onRollback}
              title={tr("chat.rollback")}
            >
              <Icon name="undo" size={13} /> {tr("chat.rollback")}
            </button>
          )}
        </div>
      </div>

      <PipelineStrip steps={pipeline} />

      {isDone && <DoneBanner detail={detail} />}
      {isFailed && (
        <div className="fail-banner">
          <Icon name="x" size={14} stroke={2.4} />
          <span>
            <strong>
              {detail.run.status === "budget_exceeded"
                ? tr("chat.budgetExceeded")
                : tr("chat.failed")}
            </strong>
            {detail.run.exitReason ? ` · ${detail.run.exitReason}` : ""}
          </span>
        </div>
      )}
      {isCancelled && (
        <div className="fail-banner" style={{ background: "var(--surface-3)", color: "var(--ink-2)" }}>
          <Icon name="stop" size={14} />
          <span>
            <strong>{tr("chat.stopped")}</strong> · {tr("chat.cancelled")}
          </span>
        </div>
      )}

      <div className="chat-stream" ref={streamRef}>
        {entries.map((entry) => renderEntry(entry, userInitials, runStartedAt))}

        {hasPendingPatch && isWaiting && (
          <div className="msg agent">
            <div className="msg-avatar">co</div>
            <div className="msg-body">
              <div className="msg-head">
                <span className="who">codey</span>
                <span className="ts">{tr("threads.pill.awaiting")}</span>
              </div>
              <PatchCard
                patch={detail.pendingPatch ?? ""}
                onOpenApproval={onOpenApproval}
                onReject={onRejectPatch}
              />
            </div>
          </div>
        )}

        {liveText && (
          <div className="msg agent">
            <div className="msg-avatar">co</div>
            <div className="msg-body">
              <div className="msg-head">
                <span className="who">codey</span>
                <span className="ts">{tr("threads.pill.live")}</span>
                <span className="dot-pulse" />
              </div>
              <div className="msg-content">{liveText}</div>
            </div>
          </div>
        )}
      </div>

      <Composer
        value={composerValue}
        busy={composerBusy || isActive}
        maxAutoSteps={maxAutoSteps}
        placeholder={
          isWaiting
            ? tr("chat.composer.replyOrApprove")
            : isActive
              ? tr("chat.composer.inProgress")
              : tr("chat.composer.followUp")
        }
        onChange={onComposerChange}
        onSubmit={onSubmitComposer}
      />
    </div>
  );
}

function renderEntry(
  entry: ChatEntry,
  userInitials: string,
  runStartedAt: number,
): JSX.Element {
  if (entry.kind === "user") {
    return (
      <div className="msg user" key={entry.key}>
        <div className="msg-body">
          <div className="msg-head">
            <span className="ts">{formatStamp(entry.at, runStartedAt)}</span>
            <span className="who">you</span>
          </div>
          <div className="msg-content">{entry.text}</div>
        </div>
        <div className="msg-avatar">{userInitials}</div>
      </div>
    );
  }
  if (entry.kind === "agent") {
    return (
      <div className="msg agent" key={entry.key}>
        <div className="msg-avatar">co</div>
        <div className="msg-body">
          <div className="msg-head">
            <span className="who">codey</span>
            <span className="ts">{formatStamp(entry.at, runStartedAt)}</span>
          </div>
          <div className="msg-content">
            <Markdown text={entry.text ?? ""} />
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "tool" && entry.tool) {
    const { name, arg, body, state } = entry.tool;
    return (
      <div className="msg agent" key={entry.key}>
        <div className="msg-avatar">co</div>
        <div className="msg-body">
          <details className={`tool ${state}`} open={state === "failed"}>
            <summary>
              <div className="tool-head">
                <span className="chev">▸</span>
                <span className="tool-pill">{name || "tool"}</span>
                <span className="tool-arg">{arg}</span>
                {state === "run" ? (
                  <span className="spinner" />
                ) : (
                  <span className="tool-status">{state === "done" ? "done" : "failed"}</span>
                )}
              </div>
            </summary>
            {body ? <div className="tool-body">{body}</div> : null}
          </details>
        </div>
      </div>
    );
  }
  if (entry.kind === "error") {
    return (
      <div className="msg agent" key={entry.key}>
        <div className="msg-avatar">co</div>
        <div className="msg-body">
          <details className="tool failed" open>
            <summary>
              <div className="tool-head">
                <span className="chev">▸</span>
                <span className="tool-pill" style={{ color: "var(--red)" }}>error</span>
                <span className="tool-arg" />
                <span className="tool-status">failed</span>
              </div>
            </summary>
            <div className="tool-body">{entry.text}</div>
          </details>
        </div>
      </div>
    );
  }
  return <></>;
}

function StatusPill({ status }: { status: AgentRunState }): JSX.Element {
  if (status === "waiting_for_user_approval") {
    return (
      <span
        className="pill-status"
        style={{ background: "var(--accent-soft)", color: "var(--accent)", borderColor: "transparent" }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 99,
            background: "var(--accent)",
            display: "inline-block",
          }}
        />
        awaiting approval
      </span>
    );
  }
  if (status === "done") {
    return (
      <span
        className="pill-status"
        style={{ background: "var(--green-soft)", color: "var(--green)", borderColor: "transparent" }}
      >
        <Icon name="check" size={11} stroke={2.4} /> applied
      </span>
    );
  }
  if (status === "failed" || status === "budget_exceeded") {
    return (
      <span
        className="pill-status"
        style={{ background: "var(--red-soft)", color: "var(--red)", borderColor: "transparent" }}
      >
        <Icon name="x" size={11} stroke={2.4} /> {status === "budget_exceeded" ? "over budget" : "failed"}
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="pill-status" style={{ background: "var(--surface-3)", color: "var(--ink-2)" }}>
        stopped
      </span>
    );
  }
  if (isRunActive(status)) {
    return (
      <span className="pill-status" style={{ background: "var(--surface-2)" }}>
        <span className="spinner" /> running
      </span>
    );
  }
  return <span className="pill-status">{status}</span>;
}

interface PipelineStep {
  name: string;
  state: "queued" | "run" | "done" | "waiting" | "failed";
}

function PipelineStrip({ steps }: { steps: PipelineStep[] }): JSX.Element {
  return (
    <div className="pipeline-strip">
      {steps.map((s) => (
        <div key={s.name} className={`pl-step ${s.state}`}>
          <span className="marker" />
          <span className="name">{s.name}</span>
          {s.state === "run" && <span className="spinner strip-tail" />}
          {s.state === "waiting" && <span className="strip-tail">review →</span>}
        </div>
      ))}
    </div>
  );
}

function buildPipeline(detail: AgentRunDetail): PipelineStep[] {
  const stages: Array<{ name: string; matches: AgentRunState[] }> = [
    { name: "plan", matches: ["planning"] },
    { name: "explore", matches: ["searching", "reading"] },
    { name: "patch", matches: ["editing", "tool_use", "applying_patch", "waiting_for_user_approval"] },
    { name: "verify", matches: ["running_command", "verifying", "repairing"] },
  ];
  const status = detail.run.status;
  let activeIndex = stages.findIndex((stage) => stage.matches.includes(status));
  if (status === "done") activeIndex = stages.length;
  if (status === "failed" || status === "budget_exceeded") {
    const lastAttempted = stages.findIndex((stage) => stage.matches.includes(status));
    if (lastAttempted >= 0) activeIndex = lastAttempted;
    else activeIndex = stages.length - 1;
    return stages.map((s, i) => ({
      name: s.name,
      state: i < activeIndex ? "done" : i === activeIndex ? "failed" : "queued",
    }));
  }
  if (status === "cancelled") {
    return stages.map((s) => ({ name: s.name, state: "queued" }));
  }
  return stages.map((s, i) => {
    if (status === "waiting_for_user_approval" && i === 2) return { name: s.name, state: "waiting" };
    if (i < activeIndex) return { name: s.name, state: "done" };
    if (i === activeIndex) return { name: s.name, state: "run" };
    return { name: s.name, state: "queued" };
  });
}

function buildEntries(
  userTask: string,
  steps: AgentStep[],
  runStartedAt: number,
): ChatEntry[] {
  const entries: ChatEntry[] = [];
  if (userTask) {
    entries.push({ key: "user-task", kind: "user", text: userTask, at: runStartedAt });
  }
  let lastTool: ChatEntry["tool"] | null = null;
  let lastToolEntry: ChatEntry | null = null;
  const taskMessageContent = `Task: ${userTask}`;
  for (const step of steps) {
    if (step.type === "message" && step.content === taskMessageContent) {
      continue;
    }
    if (step.type === "message") {
      lastTool = null;
      lastToolEntry = null;
      entries.push({
        key: step.id,
        kind: "agent",
        text: step.content,
        at: step.createdAt,
      });
      continue;
    }
    if (step.type === "tool_call") {
      const { name, arg } = parseToolCall(step.content);
      const tool: ChatEntry["tool"] = { name, arg, body: "", state: "run" };
      const entry: ChatEntry = {
        key: step.id,
        kind: "tool",
        tool,
        at: step.createdAt,
      };
      entries.push(entry);
      lastTool = tool;
      lastToolEntry = entry;
      continue;
    }
    if (step.type === "tool_result") {
      if (lastTool) {
        lastTool.body = appendBody(lastTool.body, step.content);
        lastTool.state = "done";
      } else {
        entries.push({
          key: step.id,
          kind: "tool",
          tool: { name: "result", arg: "", body: step.content, state: "done" },
          at: step.createdAt,
        });
      }
      continue;
    }
    if (step.type === "command") {
      if (lastTool) {
        lastTool.body = appendBody(lastTool.body, step.content);
      } else {
        entries.push({
          key: step.id,
          kind: "tool",
          tool: { name: "run_command", arg: "", body: step.content, state: "done" },
          at: step.createdAt,
        });
      }
      continue;
    }
    if (step.type === "diff") {
      continue;
    }
    if (step.type === "error") {
      if (lastTool && lastTool.state === "run") {
        lastTool.body = appendBody(lastTool.body, step.content);
        lastTool.state = "failed";
        lastTool = null;
        lastToolEntry = null;
      } else {
        entries.push({
          key: step.id,
          kind: "error",
          text: step.content,
          at: step.createdAt,
        });
      }
      continue;
    }
  }
  void lastToolEntry;
  return entries;
}

function parseToolCall(content: string): { name: string; arg: string } {
  const trimmed = content.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { name: trimmed, arg: "" };
  return { name: trimmed.slice(0, spaceIdx), arg: trimmed.slice(spaceIdx + 1) };
}

function appendBody(existing: string, addition: string): string {
  if (!existing) return addition;
  return `${existing}\n${addition}`;
}

interface PatchCardProps {
  patch: string;
  onOpenApproval: () => void;
  onReject: () => void;
}

function PatchCard({ patch, onOpenApproval, onReject }: PatchCardProps): JSX.Element {
  const stats = useMemo(() => summarizePatch(patch), [patch]);
  return (
    <div className="patch-card">
      <div className="row1">
        <span className="tag">patch ready</span>
        <span className="nums">
          <span className="add">+{stats.added}</span> / <span className="del">−{stats.removed}</span>
          {" · "}
          {stats.files.length} {stats.files.length === 1 ? "file" : "files"}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
          snapshot · auto
        </span>
      </div>
      <div className="files">
        {stats.files.slice(0, 8).map((f) => (
          <div className="file" key={f.path}>
            <span className={`st ${f.kind}`}>{f.kind}</span>
            <span className="pth" title={f.path}>{f.path}</span>
            <span className="ad" style={{ color: "var(--green)" }}>+{f.added}</span>
            {f.removed > 0 && (
              <span className="ad" style={{ color: "var(--red)" }}>−{f.removed}</span>
            )}
          </div>
        ))}
        {stats.files.length > 8 && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)", padding: "2px 8px" }}>
            +{stats.files.length - 8} more files
          </div>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" type="button" onClick={onOpenApproval}>
          Review &amp; sign…
        </button>
        <button className="btn ghost" type="button" onClick={onReject}>
          Reject
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() => {
            const ta = document.querySelector(
              ".composer textarea",
            ) as HTMLTextAreaElement | null;
            if (ta) {
              ta.focus();
              ta.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }}
        >
          Ask for changes
        </button>
        <span className="hint">⏎ to open</span>
      </div>
    </div>
  );
}

export interface PatchFileSummary {
  path: string;
  kind: "new" | "mod" | "del";
  added: number;
  removed: number;
}

export interface PatchSummary {
  added: number;
  removed: number;
  files: PatchFileSummary[];
}

export function summarizePatch(patch: string): PatchSummary {
  const lines = patch.split(/\r?\n/);
  const files: PatchFileSummary[] = [];
  let current: PatchFileSummary | null = null;
  let totalAdded = 0;
  let totalRemoved = 0;
  let v4aMode = false;
  let v4aAction: "new" | "mod" | "del" = "mod";

  for (const line of lines) {
    if (line === "*** Begin Patch") {
      v4aMode = true;
      continue;
    }
    if (line === "*** End Patch") {
      v4aMode = false;
      continue;
    }
    if (v4aMode) {
      const v4aMatch = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (v4aMatch) {
        if (current) files.push(current);
        v4aAction = v4aMatch[1] === "Add" ? "new" : v4aMatch[1] === "Delete" ? "del" : "mod";
        current = { path: v4aMatch[2] ?? "", kind: v4aAction, added: 0, removed: 0 };
        continue;
      }
      if (current) {
        if (line.startsWith("+") && !line.startsWith("+++")) {
          current.added += 1;
          totalAdded += 1;
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          current.removed += 1;
          totalRemoved += 1;
        }
      }
      continue;
    }
    const diffHeader = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffHeader) {
      if (current) files.push(current);
      current = { path: diffHeader[2] ?? "", kind: "mod", added: 0, removed: 0 };
      continue;
    }
    if (line.startsWith("new file mode") && current) {
      current.kind = "new";
      continue;
    }
    if (line.startsWith("deleted file mode") && current) {
      current.kind = "del";
      continue;
    }
    if (current) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        current.added += 1;
        totalAdded += 1;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        current.removed += 1;
        totalRemoved += 1;
      }
    }
  }
  if (current) files.push(current);
  return { added: totalAdded, removed: totalRemoved, files };
}

interface ComposerProps {
  value: string;
  busy: boolean;
  placeholder: string;
  maxAutoSteps: number;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function Composer({
  value,
  busy,
  placeholder,
  maxAutoSteps,
  onChange,
  onSubmit,
}: ComposerProps): JSX.Element {
  const [rows, setRows] = useState(1);
  return (
    <div className="composer">
      <div className="composer-inner">
        <textarea
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            const lines = e.target.value.split("\n").length;
            setRows(Math.min(6, Math.max(1, lines)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (!busy && value.trim()) onSubmit();
            }
          }}
        />
        <div className="composer-row">
          <button
            className="btn ghost"
            type="button"
            title="Attach file (coming soon)"
            disabled
            aria-label="Attach file"
          >
            <Icon name="folder" size={13} />
          </button>
          <span className="hint">Ctrl+↵ to run · ↑ recall</span>
          <span style={{ flex: 1 }} />
          <button
            className="btn ghost"
            type="button"
            title={`Up to ${maxAutoSteps} automatic steps per run · change in Settings → Agent`}
            disabled
          >
            Auto · {maxAutoSteps} steps
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={onSubmit}
            disabled={busy || !value.trim()}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Send <Icon name="send" size={12} stroke={2} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function DoneBanner({ detail }: { detail: AgentRunDetail }): JSX.Element {
  const fileCount = detail.steps.filter((s) => s.type === "diff").length;
  const commandsRun = detail.steps.filter((s) => s.type === "command").length;
  return (
    <div className="done-banner">
      <Icon name="check" size={14} stroke={2.4} />
      <span>
        <strong>Applied</strong>
        {fileCount > 0 ? ` · ${fileCount} ${fileCount === 1 ? "diff" : "diffs"}` : ""}
        {commandsRun > 0 ? ` · ${commandsRun} ${commandsRun === 1 ? "command" : "commands"}` : ""}
      </span>
      <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11 }}>
        run {shortRunId(detail.run.id)}
      </span>
    </div>
  );
}

function workspaceName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(-6) : id;
}

function formatElapsed(createdAt: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((updatedAt - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Format a step timestamp as elapsed-from-run-start, in the design's compact
 * style: "0:02" for seconds, "1m" / "2m" for minutes, "1h" for hours.
 */
function formatStamp(at: number | undefined, runStartedAt: number): string {
  if (!at) return "";
  const deltaMs = Math.max(0, at - runStartedAt);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    const mm = Math.floor(seconds / 60);
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const mm = Math.floor(minutes);
    const ss = String(seconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
