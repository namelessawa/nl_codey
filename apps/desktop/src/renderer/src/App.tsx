import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, AgentRunDetail, AppSettings, Workspace } from "@coding-agent/shared";
import { isRunActive, reduceAgentDetail, runPreconditionError } from "@coding-agent/shared";
import { api } from "./api.js";
import { FileTree } from "./components/FileTree.js";
import { RecentWorkspaces } from "./components/RecentWorkspaces.js";
import { StepStream } from "./components/StepStream.js";
import { TracePanel } from "./components/TracePanel.js";
import { IterationTimeline } from "./components/IterationTimeline.js";
import { ProjectCard } from "./components/ProjectCard.js";
import { BudgetIndicator } from "./components/BudgetIndicator.js";
import { DiffView } from "./components/DiffView.js";
import { CommandOutput } from "./components/CommandOutput.js";
import { SettingsModal } from "./components/SettingsModal.js";
import { Toast, type ToastMessage } from "./components/Toast.js";
import { applyAppearance } from "./appearance.js";

export function App(): JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recents, setRecents] = useState<Workspace[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [task, setTask] = useState<string>("");
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [adhocOutput, setAdhocOutput] = useState<string[]>([]);
  const [testCommand, setTestCommand] = useState<string>("npm test");
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [liveText, setLiveText] = useState<string>("");
  const [centerView, setCenterView] = useState<"stream" | "trace" | "timeline">("stream");

  const runIdRef = useRef<string | null>(null);
  runIdRef.current = detail?.run.id ?? null;

  // Load persisted UI settings once and apply theme/font size.
  useEffect(() => {
    void api
      .getSettings()
      .then((payload) => applyAppearance(payload.settings.ui))
      .catch(() => {
        /* settings unavailable; keep defaults */
      });
  }, []);

  const onSettingsSaved = useCallback((saved: AppSettings) => {
    applyAppearance(saved.ui);
  }, []);

  // Load the remembered-workspaces list once on mount.
  useEffect(() => {
    void api
      .listWorkspaces()
      .then(setRecents)
      .catch(() => {
        /* recents unavailable; left panel simply omits the list */
      });
  }, []);

  // Switch the active workspace: reset the run view and load its file tree + recents.
  const activateWorkspace = useCallback(async (ws: Workspace) => {
    setWorkspace(ws);
    setDetail(null);
    setLiveText("");
    setSelectedFile(null);
    setPreview("");
    setAdhocOutput([]);
    setFiles(await api.listWorkspaceFiles(ws.id));
    setRecents(await api.listWorkspaces());
  }, []);

  const showToast = useCallback((kind: "success" | "error", text: string) => {
    setToast({ kind, text });
  }, []);

  useEffect(() => {
    return api.onAgentEvent((event: AgentEvent) => {
      if (event.kind === "delta") {
        setLiveText((prev) => prev + event.text);
        return;
      }
      // A finalized assistant message (or a terminal run) ends the live stream.
      if (event.kind === "step_added" && event.step.type === "message") {
        setLiveText("");
      } else if (event.kind === "run_updated" && isTerminalStatus(event.run.status)) {
        setLiveText("");
      }
      setDetail((prev) => reduceAgentDetail(prev, event));
    });
  }, []);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

  const selectFile = (path: string): Promise<void> =>
    guard(async () => {
      if (!workspace) return;
      setSelectedFile(path);
      const { content } = await api.readFile(workspace.id, path);
      setPreview(content);
    });

  const runTask = (): Promise<void> =>
    guard(async () => {
      const preconditionError = runPreconditionError(Boolean(workspace), task);
      if (preconditionError) throw new Error(preconditionError);
      // workspace is non-null here: runPreconditionError guarantees it.
      setLiveText("");
      setDetail(await api.runAgentTask(workspace!.id, task.trim()));
    });

  const stopRun = (): Promise<void> =>
    guard(async () => {
      if (runIdRef.current) setDetail(await api.stopAgentRun(runIdRef.current));
    });

  const applyPatch = (): Promise<void> =>
    guard(async () => {
      if (runIdRef.current) setDetail(await api.applyAgentPatch(runIdRef.current));
    });

  const rejectPatch = (): Promise<void> =>
    guard(async () => {
      if (runIdRef.current) setDetail(await api.rejectAgentPatch(runIdRef.current));
    });

  const rollback = (): Promise<void> =>
    guard(async () => {
      if (!runIdRef.current) return;
      setDetail(await api.rollbackRun(runIdRef.current));
      if (workspace) setFiles(await api.listWorkspaceFiles(workspace.id));
    });

  const runTests = (): Promise<void> =>
    guard(async () => {
      if (!workspace) throw new Error("Open a workspace first");
      const out = await api.runCommand(workspace.id, testCommand.trim());
      setAdhocOutput((prev) => [
        ...prev,
        `$ ${out.command}\nexit: ${out.exitCode}${out.timedOut ? " (timed out)" : ""}\n${out.stdout}\n${out.stderr}`,
      ]);
    });

  const status = detail?.run.status ?? "idle";
  const isActive = isRunActive(status);
  const canApprove = status === "waiting_for_user_approval" && Boolean(detail?.pendingPatch);
  const hasSnapshots = Boolean(detail) && status !== "idle";

  const commandEntries = useMemo(() => {
    const fromSteps = (detail?.steps ?? [])
      .filter((s) => s.type === "command")
      .map((s) => s.content);
    return [...fromSteps, ...adhocOutput];
  }, [detail, adhocOutput]);

  return (
    <div className="app">
      {/* LEFT: file tree + workspace controls */}
      <section className="panel left">
        <div className="panel-head">
          <span>Workspace</span>
          <button onClick={openWorkspace}>Open</button>
        </div>
        <div className="ws-path">{workspace ? workspace.rootPath : "No workspace open"}</div>
        <RecentWorkspaces
          workspaces={recents}
          activeId={workspace?.id ?? null}
          onSelect={(id) => void openRecent(id)}
        />
        <ProjectCard files={files} />
        <FileTree files={files} selected={selectedFile} onSelect={(p) => void selectFile(p)} />
      </section>

      {/* CENTER: task input + run controls + step stream */}
      <section className="panel center">
        <div className="toolbar">
          <textarea
            className="task"
            placeholder="Describe a task, e.g. 给 parseConfig 函数添加单元测试"
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => void runTask()} disabled={isActive}>
              Run
            </button>
            <button className="danger" onClick={() => void stopRun()} disabled={!isActive}>
              Stop
            </button>
            <span className={`status-pill ${statusClass(status)}`}>{status}</span>
            <div style={{ marginLeft: "auto" }}>
              <BudgetIndicator run={detail?.run ?? null} />
            </div>
            <button
              className="icon-btn settings-trigger"
              title="设置 / Settings"
              aria-label="设置"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          </div>
          <div className="row tabs" style={{ marginTop: 8 }}>
            <button
              className={`tab ${centerView === "stream" ? "tab-active" : ""}`}
              onClick={() => setCenterView("stream")}
            >
              Steps
            </button>
            <button
              className={`tab ${centerView === "trace" ? "tab-active" : ""}`}
              onClick={() => setCenterView("trace")}
            >
              Trace
            </button>
            <button
              className={`tab ${centerView === "timeline" ? "tab-active" : ""}`}
              onClick={() => setCenterView("timeline")}
            >
              Timeline
            </button>
          </div>
        </div>
        <div className="panel-body">
          {centerView === "stream" ? (
            <StepStream steps={detail?.steps ?? []} liveText={liveText} />
          ) : centerView === "trace" ? (
            <TracePanel detail={detail} />
          ) : (
            <IterationTimeline detail={detail} />
          )}
        </div>
      </section>

      {/* RIGHT: diff (when pending) or file preview + approval controls */}
      <section className="panel right">
        <div className="panel-head">
          <span>{detail?.pendingPatch ? "Proposed Diff" : "File Preview"}</span>
          <div className="row">
            <button
              className="ok"
              onClick={() => void applyPatch()}
              disabled={!canApprove}
            >
              Apply Patch
            </button>
            <button onClick={() => void rejectPatch()} disabled={!canApprove}>
              Reject
            </button>
            <button className="danger" onClick={() => void rollback()} disabled={!hasSnapshots}>
              Rollback
            </button>
          </div>
        </div>
        <div className="panel-body">
          {detail?.pendingPatch ? (
            <DiffView patch={detail.pendingPatch} />
          ) : selectedFile ? (
            <pre className="preview">{preview}</pre>
          ) : (
            <div className="empty">Select a file or run a task to see a diff.</div>
          )}
        </div>
      </section>

      {/* BOTTOM: command / test output */}
      <section className="panel bottom">
        <div className="panel-head">
          <span>Command Output</span>
          <div className="row">
            <input
              value={testCommand}
              onChange={(e) => setTestCommand(e.target.value)}
              style={{
                background: "var(--panel)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "4px 8px",
                fontFamily: "var(--mono)",
                fontSize: 11,
              }}
            />
            <button onClick={() => void runTests()} disabled={!workspace || isActive}>
              Run Tests
            </button>
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <CommandOutput entries={commandEntries} />
      </section>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={onSettingsSaved}
        onToast={showToast}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "done") return "status-done";
  if (status === "failed" || status === "budget_exceeded") return "status-failed";
  if (status === "waiting_for_user_approval") return "status-waiting";
  return "";
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "budget_exceeded"
  );
}
