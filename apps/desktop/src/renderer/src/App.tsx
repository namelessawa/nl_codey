import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AppSettings,
  Workspace,
} from "@coding-agent/shared";
import {
  isRunActive,
  reduceAgentDetail,
  runPreconditionError,
} from "@coding-agent/shared";
import { api } from "./api.js";
import { Topbar } from "./components/Topbar.js";
import { ThreadsSidebar } from "./components/ThreadsSidebar.js";
import { EmptyView } from "./components/EmptyView.js";
import { ChatRunView } from "./components/ChatRunView.js";
import { ApprovalSheet } from "./components/ApprovalSheet.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { Toast, type ToastMessage } from "./components/Toast.js";
import { Icon } from "./components/Icons.js";
import { applyAppearance } from "./appearance.js";

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recents, setRecents] = useState<Workspace[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [liveText, setLiveText] = useState<string>("");
  const [composer, setComposer] = useState<string>("");
  const [isComposingNew, setIsComposingNew] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [approvalOpen, setApprovalOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [llmConnected, setLlmConnected] = useState<boolean>(false);
  const [userLabel, setUserLabel] = useState<string>("local");

  const activeRunIdRef = useRef<string | null>(null);
  activeRunIdRef.current = activeRunId;

  // Initial setup: apply persisted appearance + LLM-configured flag, list recents.
  useEffect(() => {
    void api
      .getSettings()
      .then((payload) => {
        applyAppearance(payload.settings.ui);
        const hasKey = Boolean(payload.settings.llm.apiKey?.trim());
        const hasProvider = Boolean(payload.settings.llm.provider);
        setLlmConnected(hasKey && hasProvider);
      })
      .catch(() => {
        /* settings unavailable; keep defaults */
      });
    void api
      .listWorkspaces()
      .then(setRecents)
      .catch(() => {
        /* recents unavailable */
      });
  }, []);

  const onSettingsSaved = useCallback((saved: AppSettings) => {
    applyAppearance(saved.ui);
    const hasKey = Boolean(saved.llm.apiKey?.trim());
    const hasProvider = Boolean(saved.llm.provider);
    setLlmConnected(hasKey && hasProvider);
  }, []);

  const showToast = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
  }, []);

  // Live event handler — keeps detail + threads + liveText in sync.
  useEffect(() => {
    return api.onAgentEvent((event: AgentEvent) => {
      if (event.kind === "delta") {
        if (event.runId === activeRunIdRef.current) {
          setLiveText((prev) => prev + event.text);
        }
        return;
      }
      if (event.kind === "step_added" && event.step.type === "message") {
        if (event.step.runId === activeRunIdRef.current) setLiveText("");
      } else if (event.kind === "run_updated" && isTerminalStatus(event.run.status)) {
        if (event.run.id === activeRunIdRef.current) setLiveText("");
      }
      // Refresh detail for the active run only.
      if (
        event.kind === "step_added" ||
        event.kind === "run_updated" ||
        event.kind === "patch_ready"
      ) {
        const eventRunId = "runId" in event ? event.runId : event.kind === "step_added" ? event.step.runId : event.kind === "run_updated" ? event.run.id : null;
        if (eventRunId && eventRunId === activeRunIdRef.current) {
          setDetail((prev) => reduceAgentDetail(prev, event));
        }
        // Always refresh the runs list when any run updates.
        if (event.kind === "run_updated") {
          setRuns((prev) => upsertRun(prev, event.run));
        }
      }
    });
  }, []);

  // Open the approval sheet automatically when the active run enters
  // waiting_for_user_approval (and a patch is present).
  useEffect(() => {
    if (
      detail &&
      detail.run.status === "waiting_for_user_approval" &&
      detail.pendingPatch
    ) {
      setApprovalOpen(true);
    } else {
      setApprovalOpen(false);
    }
  }, [detail]);

  const refreshRuns = useCallback(async (workspaceId: string) => {
    try {
      const next = await api.listAgentRuns(workspaceId);
      setRuns(next);
    } catch (err) {
      // Listing failures shouldn't block the user — log to error banner so they see why.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const activateWorkspace = useCallback(async (ws: Workspace) => {
    setWorkspace(ws);
    setActiveRunId(null);
    setDetail(null);
    setLiveText("");
    setIsComposingNew(false);
    setError(null);
    setUserLabel(`local · ${shortName(ws.rootPath)}`);
    await refreshRuns(ws.id);
    setRecents(await api.listWorkspaces());
  }, [refreshRuns]);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const openWorkspace = (): Promise<void> =>
    guard(async () => {
      const ws = await api.openWorkspace();
      if (!ws) return;
      await activateWorkspace(ws);
    });

  const openRecent = (workspaceId: string): Promise<void> =>
    guard(async () => {
      const ws = await api.openRecentWorkspace(workspaceId);
      await activateWorkspace(ws);
    });

  const selectRun = (runId: string): Promise<void> =>
    guard(async () => {
      setActiveRunId(runId);
      setIsComposingNew(false);
      setLiveText("");
      const next = await api.getAgentRun(runId);
      setDetail(next);
    });

  const newRun = (): void => {
    setIsComposingNew(true);
    setActiveRunId(null);
    setDetail(null);
    setLiveText("");
    setComposer("");
    setApprovalOpen(false);
  };

  const submitComposer = (): Promise<void> =>
    guard(async () => {
      const preconditionError = runPreconditionError(Boolean(workspace), composer);
      if (preconditionError) throw new Error(preconditionError);
      const next = await api.runAgentTask(workspace!.id, composer.trim());
      setActiveRunId(next.run.id);
      setDetail(next);
      setLiveText("");
      setComposer("");
      setIsComposingNew(false);
      setRuns((prev) => upsertRun(prev, next.run));
    });

  const stopRun = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.stopAgentRun(activeRunId);
      setDetail(next);
    });

  const applyPatch = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.applyAgentPatch(activeRunId);
      setDetail(next);
      setApprovalOpen(false);
      showToast("success", "Patch applied");
    });

  const rejectPatch = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.rejectAgentPatch(activeRunId);
      setDetail(next);
      setApprovalOpen(false);
      showToast("success", "Patch rejected");
    });

  const rollback = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.rollbackRun(activeRunId);
      setDetail(next);
      showToast("success", "Rolled back");
    });

  const isRunBusy = Boolean(detail && isRunActive(detail.run.status));
  const wsName = workspace ? shortName(workspace.rootPath) : "";

  const main = useMemo(() => {
    if (!workspace) {
      return (
        <EmptyView
          recents={recents}
          busy={busy}
          onPickWorkspace={() => void openWorkspace()}
          onOpenRecent={(id) => void openRecent(id)}
        />
      );
    }
    if (isComposingNew || !detail) {
      return (
        <NewRunCompose
          workspace={workspace}
          composer={composer}
          busy={busy}
          onComposerChange={setComposer}
          onSubmit={() => void submitComposer()}
        />
      );
    }
    return (
      <ChatRunView
        detail={detail}
        workspace={workspace}
        liveText={liveText}
        composerValue={composer}
        composerBusy={busy}
        onComposerChange={setComposer}
        onSubmitComposer={() => void submitComposer()}
        onStopRun={() => void stopRun()}
        onOpenApproval={() => setApprovalOpen(true)}
        onRollback={() => void rollback()}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, recents, busy, isComposingNew, detail, liveText, composer]);

  return (
    <div className="app">
      <Topbar
        workspace={workspace}
        activeRun={detail?.run ?? null}
        llmConnected={llmConnected}
        onSwitchWorkspace={() => void openWorkspace()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ThreadsSidebar
        runs={runs}
        activeRunId={activeRunId}
        isComposingNew={isComposingNew}
        userLabel={userLabel}
        onSelectRun={(id) => void selectRun(id)}
        onNewRun={newRun}
      />
      <div className="main">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {main}
        {approvalOpen && detail?.pendingPatch && (
          <ApprovalSheet
            patch={detail.pendingPatch}
            runIdLabel={`run ${shortRunId(detail.run.id)}`}
            taskTitle={detail.run.userTask}
            workspaceName={wsName}
            onClose={() => setApprovalOpen(false)}
            onApply={() => void applyPatch()}
            onReject={() => void rejectPatch()}
          />
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsSaved}
        onToast={showToast}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Silence eslint unused-import for isRunBusy by reading it; the value is
          exposed for future surfaces (e.g. composer state). */}
      <span style={{ display: "none" }}>{String(isRunBusy)}</span>
    </div>
  );
}

interface NewRunComposeProps {
  workspace: Workspace;
  composer: string;
  busy: boolean;
  onComposerChange: (v: string) => void;
  onSubmit: () => void;
}

function NewRunCompose({
  workspace,
  composer,
  busy,
  onComposerChange,
  onSubmit,
}: NewRunComposeProps): JSX.Element {
  return (
    <div className="main-inner">
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
        }}
      >
        <div style={{ width: "min(640px, 100%)", textAlign: "center" }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            bound · {shortName(workspace.rootPath)}
          </div>
          <h1
            style={{
              fontFamily: "var(--serif)",
              fontSize: 36,
              lineHeight: 1.1,
              fontWeight: 500,
              letterSpacing: "-0.018em",
              margin: 0,
            }}
          >
            What should the agent <em style={{ color: "var(--ink-2)" }}>do next?</em>
          </h1>
          <p
            style={{
              fontFamily: "var(--serif)",
              fontSize: 16,
              lineHeight: 1.55,
              color: "var(--ink-2)",
              maxWidth: 480,
              margin: "12px auto 0",
            }}
          >
            Describe a task in plain language. The agent plans, searches, edits, and proposes
            a patch — you sign before anything writes to disk.
          </p>
        </div>
      </div>
      <div className="composer">
        <div className="composer-inner">
          <textarea
            rows={3}
            placeholder="e.g. add a unit test for parseConfig in packages/shared"
            value={composer}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!busy && composer.trim()) onSubmit();
              }
            }}
          />
          <div className="composer-row">
            <span className="hint">Ctrl+↵ to start the run</span>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              type="button"
              onClick={onSubmit}
              disabled={busy || !composer.trim()}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Start run <Icon name="send" size={12} stroke={2} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function upsertRun(prev: AgentRun[], next: AgentRun): AgentRun[] {
  const idx = prev.findIndex((r) => r.id === next.id);
  if (idx === -1) return [next, ...prev];
  const copy = prev.slice();
  copy[idx] = next;
  return copy;
}

function shortName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(-6) : id;
}

function isTerminalStatus(status: AgentRunState): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "budget_exceeded"
  );
}
