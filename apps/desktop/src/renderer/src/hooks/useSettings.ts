import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  toLLMConfig,
  validateSettings,
  type AppSettings,
  type TestConnectionResult,
  type ValidationIssue,
} from "@nlc/shared";
import { api } from "../api.js";

export type UseSettings = {
  draft: AppSettings;
  loading: boolean;
  secretsPersistent: boolean;
  issues: ValidationIssue[];
  /** Replace the working draft (immutable update from the caller). */
  setDraft: (next: AppSettings) => void;
  /** Reload persisted settings into the draft (used on open / cancel). */
  reload: () => Promise<void>;
  save: () => Promise<AppSettings>;
  reset: () => Promise<void>;
  testConnection: () => Promise<TestConnectionResult>;
};

/** Loads, edits, validates, and persists app settings for the Settings panel. */
export function useSettings(): UseSettings {
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState<boolean>(true);
  const [secretsPersistent, setSecretsPersistent] = useState<boolean>(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.getSettings();
      setDraft(payload.settings);
      setSecretsPersistent(payload.secretsPersistent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (): Promise<AppSettings> => {
    const payload = await api.updateSettings(draft);
    setDraft(payload.settings);
    setSecretsPersistent(payload.secretsPersistent);
    return payload.settings;
  }, [draft]);

  const reset = useCallback(async () => {
    const payload = await api.resetSettings();
    setDraft(payload.settings);
    setSecretsPersistent(payload.secretsPersistent);
  }, []);

  const testConnection = useCallback(
    (): Promise<TestConnectionResult> => api.testLLMConnection(toLLMConfig(draft.llm)),
    [draft],
  );

  const { issues } = validateSettings(draft);

  return {
    draft,
    loading,
    secretsPersistent,
    issues,
    setDraft,
    reload,
    save,
    reset,
    testConnection,
  };
}
