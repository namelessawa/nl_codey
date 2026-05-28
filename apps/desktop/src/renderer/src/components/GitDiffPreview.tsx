import { useCallback, useEffect, useState } from "react";
import type { GitWorkingTreeStatus } from "@coding-agent/shared";
import { api } from "../api.js";

interface GitDiffPreviewProps {
  workspaceId: string;
  runId: string;
}

/**
 * Git workflow surface: shows the working-tree status, generates an editable
 * PR description (with copy-to-clipboard), and can discard the agent branch.
 */
export function GitDiffPreview({ workspaceId, runId }: GitDiffPreviewProps): JSX.Element {
  const [status, setStatus] = useState<GitWorkingTreeStatus | null>(null);
  const [prBody, setPrBody] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      setStatus(await api.getGitStatus(workspaceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const generatePR = useCallback(async () => {
    setError(null);
    try {
      const pr = await api.generatePRDescription(runId);
      setPrBody(`# ${pr.title}\n\n${pr.body}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prBody);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [prBody]);

  const discard = useCallback(async () => {
    if (!window.confirm("Discard the agent branch? This cannot be undone.")) return;
    setError(null);
    try {
      await api.discardAgentBranch(runId);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, loadStatus]);

  return (
    <div className="git-preview">
      {error && <div className="error-banner">{error}</div>}

      {status && (
        <div className="git-status">
          <div className="git-status-row">
            <span className="git-branch">{status.branch}</span>
            <span className={`git-clean ${status.clean ? "git-ok" : "git-dirty"}`}>
              {status.clean ? "clean" : "dirty"}
            </span>
            <span className="iter-meta">↑{status.ahead} ↓{status.behind}</span>
          </div>
          <GitFileList label="Staged" files={status.staged} />
          <GitFileList label="Modified" files={status.modified} />
          <GitFileList label="Untracked" files={status.untracked} />
        </div>
      )}

      <div className="row git-actions">
        <button onClick={() => void generatePR()}>Generate PR description</button>
        <button className="danger" onClick={() => void discard()}>
          Discard agent branch
        </button>
      </div>

      {prBody && (
        <div className="git-pr">
          <textarea
            className="mem-input git-pr-body"
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
          />
          <button onClick={() => void copy()}>{copied ? "Copied!" : "Copy"}</button>
        </div>
      )}
    </div>
  );
}

interface GitFileListProps {
  label: string;
  files: string[];
}

function GitFileList({ label, files }: GitFileListProps): JSX.Element | null {
  if (files.length === 0) return null;
  return (
    <div className="git-files">
      <span className="project-card-label">
        {label} ({files.length})
      </span>
      <ul className="file-list">
        {files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  );
}
