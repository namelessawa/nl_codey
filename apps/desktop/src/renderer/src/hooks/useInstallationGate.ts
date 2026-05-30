import { useCallback, useEffect, useState } from "react";
import type { AgentEvent, InstallationStatus } from "@coding-agent/shared";
import {
  DEFAULT_DOCKER_STATUS,
  DEFAULT_INSTALLATION_GATE,
} from "@coding-agent/shared";
import { api } from "../api.js";

/**
 * Renderer-side mirror of the main-process InstallationGate. Loads the
 * current status on mount, subscribes to `installation_status` push events,
 * and exposes the actions the modal / badge / settings need.
 *
 * Consumers should treat `status.degraded` as the canonical "is the app
 * running with unsafe-tools disabled?" flag.
 */
export type UseInstallationGate = {
  /** Current snapshot. Starts at safe defaults until the first probe lands. */
  status: InstallationStatus;
  /** True while the very first probe is in flight (boot-time only). */
  loading: boolean;
  /** True while a re-check is running (set by the modal's "Re-check" button). */
  rechecking: boolean;
  /** Trigger a fresh `docker --version` + `docker info` probe. */
  recheck: () => Promise<void>;
  /** User chose "Skip and accept the risk". */
  skip: () => Promise<void>;
  /** User cleared the skip flag from the badge or settings warning. */
  resume: () => Promise<void>;
  /** Record that the install modal has been shown once. */
  markFirstRunCompleted: () => Promise<void>;
  /** Open the Docker download page in the user's default browser. */
  openInstallPage: () => Promise<void>;
};

const INITIAL_STATUS: InstallationStatus = {
  docker: DEFAULT_DOCKER_STATUS,
  gate: DEFAULT_INSTALLATION_GATE,
  degraded: false,
};

export function useInstallationGate(): UseInstallationGate {
  const [status, setStatus] = useState<InstallationStatus>(INITIAL_STATUS);
  const [loading, setLoading] = useState<boolean>(true);
  const [rechecking, setRechecking] = useState<boolean>(false);

  useEffect(() => {
    void api
      .getInstallationStatus()
      .then((next) => setStatus(next))
      .catch(() => {
        // Handler not yet registered (race during boot) — the broadcast that
        // recheck() emits will populate state shortly. Keep defaults.
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return api.onAgentEvent((event: AgentEvent) => {
      if (event.kind === "installation_status") {
        setStatus(event.status);
      }
    });
  }, []);

  const recheck = useCallback(async (): Promise<void> => {
    setRechecking(true);
    try {
      const next = await api.recheckDocker();
      setStatus(next);
    } finally {
      setRechecking(false);
    }
  }, []);

  const skip = useCallback(async (): Promise<void> => {
    const next = await api.skipInstallationGate();
    setStatus(next);
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    const next = await api.resumeInstallationGate();
    setStatus(next);
  }, []);

  const markFirstRunCompleted = useCallback(async (): Promise<void> => {
    const next = await api.markFirstRunCompleted();
    setStatus(next);
  }, []);

  const openInstallPage = useCallback(async (): Promise<void> => {
    await api.openDockerInstallPage();
  }, []);

  return {
    status,
    loading,
    rechecking,
    recheck,
    skip,
    resume,
    markFirstRunCompleted,
    openInstallPage,
  };
}
