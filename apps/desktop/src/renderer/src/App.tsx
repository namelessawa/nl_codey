import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentEvent,
  AgentRun,
  AgentRunDetail,
  AgentRunState,
  AppSettings,
  LLMProviderId,
  Workspace,
} from "@nlc/shared";
import {
  DEFAULT_SHORTCUTS,
  PROVIDER_PRESETS,
  isRunActive,
  reduceAgentDetail,
  runPreconditionError,
} from "@nlc/shared";
import { api } from "./api.js";
import { useShortcuts } from "./hooks/useShortcuts.js";
import { useInstallationGate } from "./hooks/useInstallationGate.js";
import { Topbar } from "./components/Topbar.js";
import { ThreadsSidebar } from "./components/ThreadsSidebar.js";
import { EmptyView } from "./components/EmptyView.js";
import { ChatRunView } from "./components/ChatRunView.js";
import { ApprovalSheet } from "./components/ApprovalSheet.js";
import { SettingsModal, type SettingsTab } from "./components/SettingsModal.js";
import { DockerInstallModal } from "./components/DockerInstallModal.js";
import { QuickPrefsPopover } from "./components/QuickPrefsPopover.js";
import { ModelSwitcher } from "./components/ModelSwitcher.js";
import { RightPanel } from "./components/RightPanel.js";
import { WorkbenchModal } from "./components/WorkbenchModal.js";
import { Toast, type ToastMessage } from "./components/Toast.js";
import { Icon } from "./components/Icons.js";
import { applyAppearance } from "./appearance.js";
import { LangProvider, useT } from "./lang-context.js";
import { t, tf } from "./i18n.js";

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recents, setRecents] = useState<Workspace[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeRunId, setActiveRunIdState] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  /**
   * Per-run streaming text buffers. Keyed by runId so a delta arriving
   * BEFORE `setActiveRunId` lands (the M6 race in submitComposer) still gets
   * buffered against the correct run instead of being dropped. Cleared per
   * runId when its run reaches a terminal status, or when a non-streaming
   * step_added(message) commits the assistant text into the step log.
   * Each buffer is capped at LIVE_BUFFER_BYTE_CAP to defend against an
   * unbounded stream filling the renderer heap.
   */
  const [liveBuffers, setLiveBuffers] = useState<Record<string, string>>({});
  const [composer, setComposer] = useState<string>("");
  const [isComposingNew, setIsComposingNew] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("llm");
  const [quickPrefsOpen, setQuickPrefsOpen] = useState<boolean>(false);
  const [approvalOpen, setApprovalOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [llmConnected, setLlmConnected] = useState<boolean>(false);
  const [userLabel, setUserLabel] = useState<string>("local");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [modelSwitcherOpen, setModelSwitcherOpen] = useState<boolean>(false);
  const [modelAnchor, setModelAnchor] = useState<DOMRect | null>(null);
  const [gitRefreshTick, setGitRefreshTick] = useState<number>(0);
  const [installModalOpen, setInstallModalOpen] = useState<boolean>(false);
  const [workbenchOpen, setWorkbenchOpen] = useState<boolean>(false);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => readBoolLocal(LEFT_COLLAPSED_KEY));
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => readBoolLocal(RIGHT_COLLAPSED_KEY));

  const installation = useInstallationGate();

  const toggleLeft = useCallback(() => {
    setLeftCollapsed((c) => {
      const next = !c;
      writeBoolLocal(LEFT_COLLAPSED_KEY, next);
      return next;
    });
  }, []);
  const toggleRight = useCallback(() => {
    setRightCollapsed((c) => {
      const next = !c;
      writeBoolLocal(RIGHT_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  // First-run rule: open the install modal automatically the first time the
  // app boots without a usable Docker. Subsequent launches re-open it only
  // when the user explicitly clicks the red badge or the settings warning.
  // The companion rule lives below: once Docker becomes usable while the
  // modal is open (e.g. the user clicked "Start Docker Desktop" and the
  // daemon came up), auto-close so they can get on with using the app.
  useEffect(() => {
    if (installation.loading) return;
    const dockerUsable =
      installation.status.docker.installed && installation.status.docker.daemonRunning;
    const firstRun = !installation.status.gate.firstRunCompleted;
    if (!dockerUsable && firstRun) {
      setInstallModalOpen(true);
    }
    if (dockerUsable && installModalOpen) {
      setInstallModalOpen(false);
    }
  }, [installation.loading, installation.status, installModalOpen]);

  const openInstallReminder = useCallback(() => {
    setInstallModalOpen(true);
  }, []);

  const closeInstallReminder = useCallback(() => {
    setInstallModalOpen(false);
    if (!installation.status.gate.firstRunCompleted) {
      void installation.markFirstRunCompleted();
    }
  }, [installation]);

  const handleSkipInstall = useCallback(() => {
    void installation.skip().then(() => setInstallModalOpen(false));
  }, [installation]);

  const handleOpenDockerPage = useCallback(() => {
    void installation.openInstallPage();
  }, [installation]);

  const handleStartDocker = useCallback(async (): Promise<string | null> => {
    const result = await installation.startDocker();
    // The modal auto-closes via the dockerUsable effect when ok=true; only
    // bubble an error code up to the modal for inline rendering on failure.
    return result.ok ? null : result.error ?? "unknown_error";
  }, [installation]);

  const activeRunIdRef = useRef<string | null>(null);
  // Write-through wrapper: keep ref + state in lockstep so the live event
  // handler's runId filter never lags React's render phase. Without this the
  // ref was updated during render (`activeRunIdRef.current = activeRunId`),
  // which means deltas arriving between setActiveRunIdState and the next
  // commit could be filtered against the stale ref (M5).
  const setActiveRunId = useCallback((id: string | null) => {
    activeRunIdRef.current = id;
    setActiveRunIdState(id);
  }, []);
  const modelChipRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Mutate a single run's live buffer. Caps the buffer at 1 MiB and prefixes
   * a truncation marker when overflow occurs — protects the renderer heap
   * against an unbounded stream. Returns a new state object to keep React
   * happy on shallow compare.
   */
  const appendLive = useCallback((runId: string, text: string): void => {
    if (!runId || !text) return;
    setLiveBuffers((prev) => {
      const current = prev[runId] ?? "";
      let next = current + text;
      if (next.length > LIVE_BUFFER_BYTE_CAP) {
        next = LIVE_BUFFER_TRUNCATED_MARKER + next.slice(-LIVE_BUFFER_BYTE_CAP);
      }
      return { ...prev, [runId]: next };
    });
  }, []);

  const clearLive = useCallback((runId: string): void => {
    setLiveBuffers((prev) => {
      if (!(runId in prev)) return prev;
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  }, []);

  const clearAllLive = useCallback((): void => {
    setLiveBuffers({});
  }, []);

  // Display string for the currently-active run only. Other runs' buffers
  // sit dormant — they may catch up the user when they switch threads.
  const liveText = activeRunId ? (liveBuffers[activeRunId] ?? "") : "";

  // Initial setup: apply persisted appearance + LLM-configured flag, list recents.
  useEffect(() => {
    void api
      .getSettings()
      .then((payload) => {
        setSettings(payload.settings);
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
    setSettings(saved);
    applyAppearance(saved.ui);
    const hasKey = Boolean(saved.llm.apiKey?.trim());
    const hasProvider = Boolean(saved.llm.provider);
    setLlmConnected(hasKey && hasProvider);
  }, []);

  const showToast = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
  }, []);

  // Live event handler — keeps detail + threads + per-run live buffers in
  // sync. Deltas are buffered by event.runId (NOT activeRunIdRef) so a fast
  // stream that lands before the IPC `runAgentTask` resolves still gets
  // captured for its true run (the M6 race). The display layer reads only
  // the active run's buffer, so background runs accumulate silently.
  useEffect(() => {
    return api.onAgentEvent((event: AgentEvent) => {
      if (event.kind === "delta") {
        appendLive(event.runId, event.text);
        return;
      }
      // A non-streaming message step (the assistant turn that the loop just
      // committed) supersedes the streamed buffer — clear it so the UI
      // doesn't render the same text twice (live stream + step entry).
      if (event.kind === "step_added" && event.step.type === "message") {
        clearLive(event.step.runId);
      } else if (event.kind === "run_updated" && isTerminalStatus(event.run.status)) {
        // Terminal status: buffer is no longer being added to. Drop it so the
        // map doesn't accumulate dead runs across a long session.
        clearLive(event.run.id);
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
          // Refresh git status when a run reaches a terminal/applied state —
          // the working tree may have changed.
          if (isTerminalStatus(event.run.status) || event.run.status === "applying_patch") {
            setGitRefreshTick((t) => t + 1);
          }
        }
      }
    });
  }, [appendLive, clearLive]);

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
    clearAllLive();
    setIsComposingNew(false);
    setError(null);
    setUserLabel(`local · ${shortName(ws.rootPath)}`);
    await refreshRuns(ws.id);
    setRecents(await api.listWorkspaces());
  }, [refreshRuns, clearAllLive, setActiveRunId]);

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
      // Switch the active run; setActiveRunId is write-through so the ref
      // is correct before any await yields. The selected run's buffer
      // survives across switches so the user sees an in-flight stream if
      // they revisit a run while it's still emitting.
      setActiveRunId(runId);
      setIsComposingNew(false);
      const next = await api.getAgentRun(runId);
      setDetail(next);
    });

  const newRun = (): void => {
    setIsComposingNew(true);
    setActiveRunId(null);
    setDetail(null);
    setComposer("");
    setApprovalOpen(false);
  };

  const submitComposer = (): Promise<void> =>
    guard(async () => {
      const preconditionError = runPreconditionError(Boolean(workspace), composer);
      if (preconditionError) throw new Error(preconditionError);
      const text = composer.trim();
      // Continue the current run if one is open, not being recomposed, and
      // already in a finished state. Otherwise spin up a fresh run.
      const continuing = Boolean(
        detail && !isComposingNew && !isRunActive(detail.run.status),
      );
      const next = continuing
        ? await api.continueAgentTask(detail!.run.id, text)
        : await api.runAgentTask(workspace!.id, text);
      // setActiveRunId is write-through (M5): the ref updates synchronously
      // so the next delta event filter sees the correct run. The buffer for
      // this run may already contain deltas that landed during the IPC
      // round-trip (M6 — driveLoop fires before IPC returns) — those are
      // kept, not zeroed, so the user sees the in-flight output.
      setActiveRunId(next.run.id);
      setDetail(next);
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
      showToast("success", t("toast.patchApplied", lang));
    });

  const rejectPatch = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.rejectAgentPatch(activeRunId);
      setDetail(next);
      setApprovalOpen(false);
      showToast("success", t("toast.patchRejected", lang));
    });

  const rollback = (): Promise<void> =>
    guard(async () => {
      if (!activeRunId) return;
      const next = await api.rollbackRun(activeRunId);
      setDetail(next);
      showToast("success", t("toast.rolledBack", lang));
    });

  const clearRuns = (): Promise<void> =>
    guard(async () => {
      if (!workspace) return;
      const { deleted } = await api.clearAgentRuns(workspace.id);
      setRuns([]);
      setActiveRunId(null);
      setDetail(null);
      clearAllLive();
      setApprovalOpen(false);
      setIsComposingNew(false);
      const msg =
        deleted === 0
          ? t("toast.noRunsToClear", lang)
          : deleted === 1
            ? t("toast.clearedRun", lang)
            : tf("toast.clearedRuns", lang, { n: deleted });
      showToast("success", msg);
    });

  const isRunBusy = Boolean(detail && isRunActive(detail.run.status));
  const wsName = workspace ? shortName(workspace.rootPath) : "";
  const userInitials = useMemo(() => deriveInitials(userLabel), [userLabel]);
  const maxAutoSteps = settings?.agent.maxAutoSteps ?? 10;
  const currentModel = settings?.llm.model ?? "";
  const currentProvider: LLMProviderId = settings?.llm.provider ?? "deepseek";

  const onPickModel = useCallback(
    (model: string, provider: LLMProviderId) => {
      if (!settings) return;
      // If the provider changed, swap base URL too so the LLM client targets
      // the right endpoint; if the same provider, keep the user's customised
      // baseUrl untouched.
      const providerChanged = provider !== settings.llm.provider;
      const next: AppSettings = {
        ...settings,
        llm: {
          ...settings.llm,
          model,
          provider,
          ...(providerChanged ? { baseUrl: PROVIDER_PRESETS[provider].baseUrl } : {}),
        },
      };
      setSettings(next);
      void api
        .updateSettings(next)
        .then((payload) => {
          setSettings(payload.settings);
          showToast("success", tf("toast.switchedModel", lang, { model }));
        })
        .catch((err) => {
          showToast("error", err instanceof Error ? err.message : String(err));
        });
    },
    [settings, showToast],
  );

  const openModelSwitcher = useCallback(() => {
    if (modelChipRef.current) {
      setModelAnchor(modelChipRef.current.getBoundingClientRect());
    }
    setModelSwitcherOpen((o) => !o);
  }, []);
  const hasPendingPatch = Boolean(detail?.pendingPatch);
  const isDetailActive = Boolean(detail && isRunActive(detail.run.status));
  const isDetailDone = detail?.run.status === "done";

  const navigateRun = useCallback(
    (delta: number) => {
      if (runs.length === 0) return;
      const idx = activeRunId ? runs.findIndex((r) => r.id === activeRunId) : -1;
      const nextIdx = ((idx === -1 ? 0 : idx + delta) + runs.length) % runs.length;
      const next = runs[nextIdx];
      if (next) void selectRun(next.id);
    },
    // selectRun is stable per-render via guard; runs/activeRunId drive the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, activeRunId],
  );

  useShortcuts(settings?.shortcuts ?? DEFAULT_SHORTCUTS, {
    "new-run": newRun,
    "open-workspace": () => void openWorkspace(),
    "stop-run": isDetailActive ? () => void stopRun() : undefined,
    "approve-patch": hasPendingPatch ? () => setApprovalOpen(true) : undefined,
    "open-diff": hasPendingPatch ? () => setApprovalOpen(true) : undefined,
    "reject-patch": hasPendingPatch ? () => void rejectPatch() : undefined,
    rollback: isDetailDone ? () => void rollback() : undefined,
    "quick-prefs": () => setQuickPrefsOpen((o) => !o),
    "open-settings": () => {
      setSettingsInitialTab("llm");
      setSettingsOpen(true);
    },
    "next-thread": () => navigateRun(1),
    "prev-thread": () => navigateRun(-1),
  });

  // Identifies which view the main slot is currently rendering. Drives the
  // cross-fade animation keyed by `data-view`; the value is also used as the
  // React key so each view re-mounts cleanly when the user switches.
  const viewKind: "empty" | "compose" | "chat" = !workspace
    ? "empty"
    : isComposingNew || !detail
      ? "compose"
      : "chat";
  const viewKey =
    viewKind === "chat" && detail ? `chat:${detail.run.id}` : viewKind;

  // Active UI language. Falls back to zh-CN before settings load — matches the
  // default in DEFAULT_SETTINGS.ui so the very first paint isn't English noise
  // for a Chinese-speaking user.
  const lang = settings?.ui.language ?? "zh-CN";

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
        userInitials={userInitials}
        maxAutoSteps={maxAutoSteps}
        onComposerChange={setComposer}
        onSubmitComposer={() => void submitComposer()}
        onStopRun={() => void stopRun()}
        onOpenApproval={() => setApprovalOpen(true)}
        onRejectPatch={() => void rejectPatch()}
        onRollback={() => void rollback()}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, recents, busy, isComposingNew, detail, liveText, composer, userInitials, maxAutoSteps]);

  const appClass =
    "app" +
    (leftCollapsed ? " collapsed-left" : "") +
    (rightCollapsed ? " collapsed-right" : "");

  return (
    <LangProvider value={lang}>
    <div className={appClass}>
      <Topbar
        ref={modelChipRef}
        workspace={workspace}
        activeRun={detail?.run ?? null}
        llmConnected={llmConnected}
        currentModel={currentModel}
        installation={installation.status}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        onSwitchWorkspace={() => void openWorkspace()}
        onOpenModelSwitcher={openModelSwitcher}
        onOpenSettings={() => {
          setSettingsInitialTab("llm");
          setSettingsOpen(true);
        }}
        onOpenInstallReminder={openInstallReminder}
        onOpenWorkbench={() => setWorkbenchOpen(true)}
      />
      <ThreadsSidebar
        runs={runs}
        activeRunId={activeRunId}
        isComposingNew={isComposingNew}
        userLabel={userLabel}
        quickPrefsOpen={quickPrefsOpen}
        canClear={Boolean(workspace)}
        onSelectRun={(id) => void selectRun(id)}
        onNewRun={newRun}
        onClearRuns={() => void clearRuns()}
        onOpenQuickPrefs={() => setQuickPrefsOpen((o) => !o)}
      />
      <div className="main" data-view={viewKind}>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div key={viewKey} className="view-slot" data-view={viewKind}>
          {main}
        </div>
        {approvalOpen && detail?.pendingPatch && (
          <ApprovalSheet
            patch={detail.pendingPatch}
            runIdLabel={`${t("topbar.runHash", lang)} ${shortRunId(detail.run.id)}`}
            taskTitle={detail.run.userTask}
            workspaceName={wsName}
            onClose={() => setApprovalOpen(false)}
            onApply={() => void applyPatch()}
            onReject={() => void rejectPatch()}
          />
        )}
      </div>

      <RightPanel
        detail={detail}
        workspace={workspace}
        refreshTick={gitRefreshTick}
      />

      <ModelSwitcher
        open={modelSwitcherOpen}
        anchorRect={modelAnchor}
        currentModel={currentModel}
        currentProvider={currentProvider}
        onPick={onPickModel}
        onOpenSettings={() => {
          setSettingsInitialTab("llm");
          setSettingsOpen(true);
        }}
        onClose={() => setModelSwitcherOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        initialTab={settingsInitialTab}
        installation={installation.status}
        onRequestDockerInstall={() => {
          setSettingsOpen(false);
          setInstallModalOpen(true);
        }}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsSaved}
        onToast={showToast}
      />
      <WorkbenchModal
        open={workbenchOpen}
        workspaceId={workspace?.id ?? null}
        runId={detail?.run.id ?? null}
        lang={lang}
        onClose={() => setWorkbenchOpen(false)}
      />
      <DockerInstallModal
        open={installModalOpen}
        status={installation.status}
        rechecking={installation.rechecking}
        starting={installation.starting}
        onRecheck={() => void installation.recheck()}
        onInstall={handleOpenDockerPage}
        onSkip={handleSkipInstall}
        onClose={closeInstallReminder}
        onStart={handleStartDocker}
      />
      <QuickPrefsPopover
        open={quickPrefsOpen}
        onClose={() => setQuickPrefsOpen(false)}
        onOpenFullSettings={() => {
          setSettingsInitialTab("ui");
          setSettingsOpen(true);
        }}
        onSaved={onSettingsSaved}
        onToast={showToast}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Silence eslint unused-import for isRunBusy by reading it; the value is
          exposed for future surfaces (e.g. composer state). */}
      <span style={{ display: "none" }}>{String(isRunBusy)}</span>
    </div>
    </LangProvider>
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
  const tr = useT();
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
            {tr("compose.bound")} · {shortName(workspace.rootPath)}
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
            {tr("compose.headingA")}{" "}
            <em style={{ color: "var(--ink-2)" }}>{tr("compose.headingB")}</em>
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
            {tr("compose.lede")}
          </p>
        </div>
      </div>
      <div className="composer">
        <div className="composer-inner">
          <textarea
            rows={3}
            placeholder={tr("compose.placeholder")}
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
            <span className="hint">{tr("compose.hintStart")}</span>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              type="button"
              onClick={onSubmit}
              disabled={busy || !composer.trim()}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {tr("compose.start")} <Icon name="send" size={12} stroke={2} />
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

function deriveInitials(label: string): string {
  const first = label.trim().split(/[\s·]+/)[0] ?? "";
  return (first.slice(0, 2) || "me").toLowerCase();
}

function isTerminalStatus(status: AgentRunState): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "budget_exceeded"
  );
}

const LEFT_COLLAPSED_KEY = "ui.leftCollapsed";
const RIGHT_COLLAPSED_KEY = "ui.rightCollapsed";

/**
 * Hard cap on a single run's live-stream buffer (renderer side). 1 MiB is
 * generous for any reasonable model turn (assistant text alone, deltas
 * before they commit to a step). Beyond this the buffer self-truncates
 * from the head so the renderer heap stays bounded even if a runaway
 * stream comes in (e.g. a model stuck repeating tokens).
 */
const LIVE_BUFFER_BYTE_CAP = 1_048_576;
const LIVE_BUFFER_TRUNCATED_MARKER = "[…earlier output truncated…]\n";

function readBoolLocal(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBoolLocal(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // localStorage unavailable (e.g. private mode) — non-fatal, state still works in-memory.
  }
}
