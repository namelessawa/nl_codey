/**
 * React hook that bridges `AgentService` events to TUI state. Owns:
 *
 *  - the rolling message stream the centre pane renders (finalised; routed
 *    through Ink's `<Static>` so each row falls into the terminal's native
 *    scrollback and is never repainted),
 *  - the in-progress streaming agent message (mutates as deltas arrive;
 *    lives in the live frame so the user sees text appear in real time),
 *  - the live trace items the right pane renders,
 *  - the pending approval state (when the agent wants `apply_patch`),
 *  - the busy flag and abort handle.
 *
 * Why split finalised vs live: Ink's `<Static>` only re-renders items
 * appended since its last paint — it deliberately ignores mutations so
 * each row can flow into the OS scrollback and stay visible when the user
 * scrolls up with the wheel. The streaming agent message MUST mutate
 * (deltas accumulate), so it lives outside `<Static>` until it
 * terminates, at which point we "flush" it: push the final text into the
 * Static stream and clear the live slot.
 *
 * We reuse the existing CLI services factory (same one used by `nlc run`),
 * which builds an `AgentService` against `~/.nlc`. The TUI is just another
 * subscriber to the same `emit` channel.
 */
import { useEffect, useMemo, useReducer, useRef } from "react";
import path from "node:path";
import { nlcRoot, type AgentEvent } from "@nlc/shared";
import type { LoadedSession, SessionSummary } from "@nlc/session";
import { renderProjectTree } from "@nlc/session";
import { buildCliServices, type CliServices } from "../lib/services.js";
import { SessionBridge, sessionRootFor } from "./session-bridge.js";

export type RoleKey = "user" | "agent" | "tool" | "verify" | "error" | "system";

export type StreamItem = {
  id: string;
  role: RoleKey;
  label: string;
  text: string;
};

export type TraceItem = {
  id: string;
  kind: "tool_call" | "tool_result" | "patch" | "status";
  label: string;
  detail: string;
  ts: number;
};

type State = {
  /** Finalised messages — routed through `<Static>` into terminal scrollback. */
  stream: StreamItem[];
  /** Currently-streaming agent message (mutates on each delta). Null when idle. */
  liveAgent: StreamItem | null;
  trace: TraceItem[];
  pendingApproval: { runId: string; patch: string } | null;
  isRunning: boolean;
  status: string;
  workspaceRoot: string;
  dataRoot: string;
};

type Action =
  | { type: "append"; item: StreamItem }
  | { type: "trace"; item: TraceItem }
  | { type: "delta"; text: string }
  | { type: "flush" }
  | { type: "set-approval"; payload: { runId: string; patch: string } | null }
  | { type: "set-running"; value: boolean }
  | { type: "set-status"; value: string }
  | { type: "clear" };

const MAX_STREAM = 500;
const MAX_TRACE = 200;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "append": {
      // Any non-delta event finalises the streaming agent message: push it
      // to the Static stream before the new item so order is preserved.
      const flushed = state.liveAgent
        ? trimTail(state.stream, state.liveAgent, MAX_STREAM)
        : state.stream;
      return {
        ...state,
        stream: trimTail(flushed, action.item, MAX_STREAM),
        liveAgent: null,
      };
    }
    case "trace":
      return { ...state, trace: trimTail(state.trace, action.item, MAX_TRACE) };
    case "delta": {
      const live = state.liveAgent;
      const id = live?.id ?? `delta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const text = (live?.text ?? "") + action.text;
      return {
        ...state,
        liveAgent: { id, role: "agent", label: "agent", text },
      };
    }
    case "flush": {
      if (!state.liveAgent) return state;
      return {
        ...state,
        stream: trimTail(state.stream, state.liveAgent, MAX_STREAM),
        liveAgent: null,
      };
    }
    case "set-approval":
      return { ...state, pendingApproval: action.payload };
    case "set-running":
      return { ...state, isRunning: action.value };
    case "set-status":
      return { ...state, status: action.value };
    case "clear":
      return { ...state, stream: [], trace: [], liveAgent: null };
  }
}

function trimTail<T>(arr: T[], item: T, max: number): T[] {
  const next = [...arr, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

export type UseLoopOptions = {
  workspaceRoot?: string;
  dataRoot?: string;
  autoApprove?: boolean;
};

export function useLoop(opts: UseLoopOptions = {}) {
  const dataRoot = opts.dataRoot ?? nlcRoot();
  const workspaceRoot = opts.workspaceRoot ?? process.cwd();
  const autoApprove = opts.autoApprove ?? false;

  const [state, dispatch] = useReducer(reducer, {
    stream: [],
    liveAgent: null,
    trace: [],
    pendingApproval: null,
    isRunning: false,
    status: "idle",
    workspaceRoot,
    dataRoot,
  });

  // Services bundle is created lazily on first submit. We keep it in a ref
  // so subsequent submits reuse the same AgentService + storage handle
  // (and so a Storage construction failure — typically the dev-tree ABI
  // mismatch — only happens once per session).
  const servicesRef = useRef<CliServices | null>(null);
  const errorRef = useRef<string | null>(null);
  // Session bridge: append-only JSONL log under ~/.nlc/agent.session/.
  // Independent of `servicesRef` — works even when SQLite-backed storage
  // fails to open, so the conversation tree is captured regardless.
  const bridgeRef = useRef<SessionBridge | null>(null);

  const getServices = (): CliServices | null => {
    if (servicesRef.current) return servicesRef.current;
    if (errorRef.current) return null;
    try {
      servicesRef.current = buildCliServices({
        dataRoot,
        emit: (event) => {
          bridgeRef.current?.handleAgentEvent(event);
          handleEvent(event, dispatch, autoApprove, servicesRef);
        },
      });
      return servicesRef.current;
    } catch (err) {
      errorRef.current = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "append",
        item: {
          id: `err-${Date.now()}`,
          role: "error",
          label: "system",
          text: `Could not open ~/.nlc storage: ${errorRef.current}`,
        },
      });
      return null;
    }
  };

  const getBridge = (): SessionBridge => {
    if (bridgeRef.current) return bridgeRef.current;
    bridgeRef.current = new SessionBridge({
      cwd: workspaceRoot,
      sessionRoot: sessionRootFor(dataRoot),
    });
    return bridgeRef.current;
  };

  useEffect(() => {
    return () => {
      try {
        servicesRef.current?.storage.close();
      } catch {
        /* best-effort */
      }
      try {
        bridgeRef.current?.close();
      } catch {
        /* best-effort */
      }
    };
  }, []);

  const submit = async (task: string): Promise<void> => {
    const trimmed = task.trim();
    if (!trimmed) return;
    dispatch({
      type: "append",
      item: { id: `u-${Date.now()}`, role: "user", label: "user", text: trimmed },
    });
    // Capture the user message in the session BEFORE the agent run so
    // the file always contains the prompt even if the run dies mid-flight.
    try {
      getBridge().recordUserMessage(trimmed);
    } catch {
      /* best-effort — session capture must never block a run */
    }
    const services = getServices();
    if (!services) return;
    try {
      const workspace = services.storage.upsertWorkspace(workspaceRoot);
      dispatch({ type: "set-running", value: true });
      dispatch({ type: "set-status", value: "tool_use" });
      const detail = await services.agent.runTask(workspace.id, trimmed);
      const runId = detail.run.id;
      await waitTerminal(services, runId, dispatch);
    } catch (err) {
      dispatch({
        type: "append",
        item: {
          id: `err-${Date.now()}`,
          role: "error",
          label: "system",
          text: err instanceof Error ? err.message : String(err),
        },
      });
      dispatch({ type: "set-running", value: false });
    }
  };

  const approve = (): void => {
    const services = servicesRef.current;
    const pending = state.pendingApproval;
    if (!services || !pending) return;
    services.agent.applyPatch(pending.runId).catch((err) => {
      dispatch({
        type: "append",
        item: {
          id: `err-${Date.now()}`,
          role: "error",
          label: "system",
          text: `approve failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    });
    dispatch({ type: "set-approval", payload: null });
  };

  const reject = (): void => {
    const services = servicesRef.current;
    const pending = state.pendingApproval;
    if (!services || !pending) return;
    services.agent.rejectPatch(pending.runId);
    dispatch({ type: "set-approval", payload: null });
  };

  const cancel = (): void => {
    const services = servicesRef.current;
    if (!services) return;
    // Stop every active run — usually one at a time in the TUI.
    const ws = services.storage.listWorkspaces(1)[0];
    if (!ws) return;
    for (const r of services.agent.listRuns(ws.id)) {
      if (!isTerminal(r.status)) services.agent.stop(r.id);
    }
  };

  const clear = (): void => dispatch({ type: "clear" });

  /**
   * Append a synthetic local system message — does NOT touch the LLM,
   * does NOT touch storage. Used by `/help`, `/settings`, `/cd`, and
   * any other purely-local command that needs to surface text in the
   * stream pane.
   */
  const appendSystem = (text: string, label = "system"): void => {
    dispatch({
      type: "append",
      item: {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "system",
        label,
        text,
      },
    });
  };

  // --- Session ops exposed to the TUI command surface ---

  /** Current session id (lazy — null until the first user message). */
  const currentSessionId = (): string | null => bridgeRef.current?.currentSessionId ?? null;

  /** Return one summary row per session in this workspace. */
  const listSessions = (): SessionSummary[] => getBridge().listSessions();

  /** Load every session in this workspace (for /tree rendering). */
  const loadAllSessions = (): LoadedSession[] => getBridge().loadAllSessions();

  /** Render the project's conversation tree as a plain string. */
  const renderTree = (): string => {
    const bridge = getBridge();
    return renderProjectTree(bridge.loadAllSessions(), bridge.listSessions(), {
      ...(bridge.currentSessionId
        ? { activeSessionId: bridge.currentSessionId }
        : {}),
    });
  };

  /** Branch from a message in some prior session and switch to the new file. */
  const branchAt = (parentSessionId: string, parentMessageId: string): string => {
    const writer = getBridge().branchFrom(parentSessionId, parentMessageId);
    return writer.header.id;
  };

  /** Resume an existing session as the active writer. Accepts id or absolute path. */
  const resumeSession = (idOrPath: string): { id: string; filePath: string } => {
    const bridge = getBridge();
    const filePath = idOrPath.includes(path.sep) || idOrPath.endsWith(".json")
      ? idOrPath
      : bridge.filePathFor(idOrPath);
    if (!filePath) throw new Error(`unknown session id: ${idOrPath}`);
    const writer = bridge.resume(filePath);
    return { id: writer.header.id, filePath: writer.filePath };
  };

  /** Append a state-change event to the active session file. */
  const recordStateChange = (
    kind: "model_change" | "thinking_level_change" | "theme_change" | "workspace_change",
    from: string | { provider: string; model: string } | null,
    to: string | { provider: string; model: string },
  ): void => {
    try {
      getBridge().recordStateEvent(kind, from, to);
    } catch {
      /* best-effort */
    }
  };

  return useMemo(
    () => ({
      stream: state.stream,
      liveAgent: state.liveAgent,
      trace: state.trace,
      pendingApproval: state.pendingApproval,
      isRunning: state.isRunning,
      status: state.status,
      workspaceRoot: state.workspaceRoot,
      dataRoot: state.dataRoot,
      submit,
      approve,
      reject,
      cancel,
      clear,
      appendSystem,
      // session ops
      currentSessionId,
      listSessions,
      loadAllSessions,
      renderTree,
      branchAt,
      resumeSession,
      recordStateChange,
    }),
    [state],
  );
}

function handleEvent(
  event: AgentEvent,
  dispatch: React.Dispatch<Action>,
  autoApprove: boolean,
  servicesRef: { current: CliServices | null },
): void {
  switch (event.kind) {
    case "delta":
      dispatch({ type: "delta", text: event.text });
      break;
    case "step_added": {
      const s = event.step;
      const id = s.id;
      switch (s.type) {
        case "tool_call":
          dispatch({
            type: "trace",
            item: { id, kind: "tool_call", label: s.content, detail: "", ts: s.createdAt },
          });
          dispatch({
            type: "append",
            item: { id, role: "tool", label: tagFromToolCall(s.content), text: s.content },
          });
          break;
        case "tool_result":
          dispatch({
            type: "trace",
            item: { id, kind: "tool_result", label: "result", detail: s.content, ts: s.createdAt },
          });
          break;
        case "error":
          dispatch({
            type: "append",
            item: { id, role: "error", label: "error", text: s.content },
          });
          break;
        case "diff":
          dispatch({
            type: "trace",
            item: { id, kind: "patch", label: "patch", detail: shortenDiff(s.content), ts: s.createdAt },
          });
          break;
        case "command":
          dispatch({
            type: "append",
            item: { id, role: "tool", label: "verify", text: s.content },
          });
          break;
        case "message":
          if (!s.content.startsWith("Task:")) {
            dispatch({
              type: "append",
              item: { id, role: "system", label: "system", text: s.content },
            });
          }
          break;
      }
      break;
    }
    case "patch_ready":
      if (autoApprove) {
        servicesRef.current?.agent.applyPatch(event.runId).catch(() => {
          /* swallow — surfaced via the next error step */
        });
      } else {
        dispatch({
          type: "set-approval",
          payload: { runId: event.runId, patch: event.patch },
        });
      }
      break;
    case "run_updated":
      dispatch({ type: "set-status", value: event.run.status });
      if (isTerminal(event.run.status)) {
        // Run is over — flush any half-streamed agent text into the
        // Static stream so the row falls into terminal scrollback and
        // the live frame goes idle.
        dispatch({ type: "flush" });
        dispatch({ type: "set-running", value: false });
      }
      break;
    default:
      break;
  }
}

function tagFromToolCall(line: string): string {
  // line shape from service.ts: `<toolName> <summary>`
  const name = line.split(/\s+/)[0] ?? "tool";
  return `tool:${name}`;
}

function shortenDiff(diff: string): string {
  const head = diff.split("\n").slice(0, 4).join("\n");
  return diff.length > head.length ? `${head}\n…` : head;
}

async function waitTerminal(
  services: CliServices,
  runId: string,
  dispatch: React.Dispatch<Action>,
): Promise<void> {
  while (true) {
    const detail = services.agent.getDetail(runId);
    if (isTerminal(detail.run.status)) {
      dispatch({ type: "flush" });
      dispatch({ type: "set-running", value: false });
      dispatch({ type: "set-status", value: detail.run.status });
      return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "failed" || status === "cancelled" || status === "budget_exceeded";
}
