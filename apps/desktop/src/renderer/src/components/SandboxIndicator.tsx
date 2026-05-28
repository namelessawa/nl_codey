import { useCallback, useEffect, useState } from "react";
import type { SandboxMode } from "@coding-agent/shared";
import { api } from "../api.js";

interface SandboxIndicatorProps {
  workspaceId: string;
}

const MODE_LABEL: Record<SandboxMode, string> = {
  whitelist: "native (whitelist)",
  wsl: "WSL",
  docker: "Docker",
};

const MODES: SandboxMode[] = ["whitelist", "wsl", "docker"];

/**
 * Sandbox mode badge + selector: shows the active command-routing mode and lets
 * the user switch between native whitelist, WSL, and Docker execution.
 */
export function SandboxIndicator({ workspaceId }: SandboxIndicatorProps): JSX.Element {
  const [mode, setMode] = useState<SandboxMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .getSandboxMode(workspaceId)
      .then((m) => {
        if (!cancelled) setMode(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const onChange = useCallback(
    async (next: SandboxMode) => {
      setError(null);
      try {
        setMode(await api.setSandboxMode(workspaceId, next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [workspaceId],
  );

  return (
    <div className="sandbox-indicator">
      <span className={`sandbox-badge sandbox-${mode ?? "whitelist"}`}>
        {mode ? MODE_LABEL[mode] : "…"}
      </span>
      <select
        className="sandbox-select"
        value={mode ?? "whitelist"}
        onChange={(e) => void onChange(e.target.value as SandboxMode)}
        disabled={mode === null}
      >
        {MODES.map((m) => (
          <option key={m} value={m}>
            {MODE_LABEL[m]}
          </option>
        ))}
      </select>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
