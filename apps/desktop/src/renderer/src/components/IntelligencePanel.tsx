import { useState } from "react";
import { MemoryPanel } from "./MemoryPanel.js";
import { TaskTreeView } from "./TaskTreeView.js";
import { RoleTimeline } from "./RoleTimeline.js";
import { GitDiffPreview } from "./GitDiffPreview.js";
import { FailureLibraryView } from "./FailureLibraryView.js";
import { SandboxIndicator } from "./SandboxIndicator.js";
import { SemanticSearchView } from "./SemanticSearchView.js";
import { DebugView } from "./DebugView.js";

interface IntelligencePanelProps {
  workspaceId: string;
  runId: string | null;
}

type IntelligenceTab = "memory" | "tasks" | "roles" | "git" | "failures" | "search" | "debug";

const TABS: { id: IntelligenceTab; label: string }[] = [
  { id: "memory", label: "Memory" },
  { id: "failures", label: "Failures" },
  { id: "tasks", label: "Tasks" },
  { id: "roles", label: "Roles" },
  { id: "git", label: "Git" },
  { id: "search", label: "Semantic search" },
  { id: "debug", label: "Debug" },
];

/**
 * Phase 3 surface: composes the long-term memory, task DAG, role timeline,
 * git workflow, and failure-library views, with a sandbox-mode indicator in
 * the header. Run-scoped views prompt to run a task when no run exists yet.
 */
export function IntelligencePanel({ workspaceId, runId }: IntelligencePanelProps): JSX.Element {
  const [tab, setTab] = useState<IntelligenceTab>("memory");

  return (
    <div className="intelligence-panel">
      <div className="intelligence-head">
        <div className="row tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "tab-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <SandboxIndicator workspaceId={workspaceId} />
      </div>

      <div className="intelligence-body">
        {tab === "memory" && <MemoryPanel workspaceId={workspaceId} />}
        {tab === "failures" && <FailureLibraryView workspaceId={workspaceId} />}
        {tab === "tasks" &&
          (runId ? (
            <TaskTreeView runId={runId} />
          ) : (
            <div className="empty">Run a task to see its breakdown.</div>
          ))}
        {tab === "roles" &&
          (runId ? (
            <RoleTimeline runId={runId} />
          ) : (
            <div className="empty">Run a task to see role messages.</div>
          ))}
        {tab === "git" &&
          (runId ? (
            <GitDiffPreview workspaceId={workspaceId} runId={runId} />
          ) : (
            <div className="empty">Run a task to inspect git state.</div>
          ))}
        {tab === "search" && <SemanticSearchView workspaceId={workspaceId} />}
        {tab === "debug" && <DebugView workspaceId={workspaceId} />}
      </div>
    </div>
  );
}
