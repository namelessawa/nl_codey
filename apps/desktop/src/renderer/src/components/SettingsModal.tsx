import { useEffect, useState } from "react";
import type { AppSettings, TestConnectionResult } from "@coding-agent/shared";
import { useSettings } from "../hooks/useSettings.js";
import { t } from "../i18n.js";
import { LLMSettings } from "./settings/LLMSettings.js";
import { AgentSettings } from "./settings/AgentSettings.js";
import { UISettings } from "./settings/UISettings.js";

type Tab = "llm" | "agent" | "ui";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  onToast: (kind: "success" | "error", text: string) => void;
};

export function SettingsModal({ open, onClose, onSaved, onToast }: Props): JSX.Element | null {
  const { draft, loading, secretsPersistent, issues, setDraft, reload, save, reset, testConnection } =
    useSettings();
  const [tab, setTab] = useState<Tab>("llm");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const lang = draft.ui.language;

  // Refresh from disk each time the panel opens so it always reflects saved state.
  useEffect(() => {
    if (open) {
      void reload();
      setTestResult(null);
      setTab("llm");
    }
  }, [open, reload]);

  if (!open) return null;

  const handleCancel = (): void => {
    void reload();
    onClose();
  };

  const handleSave = async (): Promise<void> => {
    if (issues.length > 0) {
      onToast("error", issues[0]?.message ?? t("settings.saveFailed", lang));
      return;
    }
    setSaving(true);
    try {
      const saved = await save();
      onSaved(saved);
      onToast("success", t("settings.saved", lang));
      onClose();
    } catch (err) {
      onToast("error", `${t("settings.saveFailed", lang)}: ${asMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    if (!window.confirm(t("settings.resetConfirm", lang))) return;
    try {
      await reset();
      onToast("success", t("settings.saved", lang));
    } catch (err) {
      onToast("error", `${t("settings.saveFailed", lang)}: ${asMessage(err)}`);
    }
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection());
    } catch (err) {
      setTestResult({ ok: false, message: asMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={handleCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title", lang)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span>{t("settings.title", lang)}</span>
          <button className="icon-btn" onClick={handleCancel} aria-label={t("settings.cancel", lang)}>
            ✕
          </button>
        </div>

        <div className="modal-tabs">
          <button className={tab === "llm" ? "active" : ""} onClick={() => setTab("llm")}>
            {t("group.llm", lang)}
          </button>
          <button className={tab === "agent" ? "active" : ""} onClick={() => setTab("agent")}>
            {t("group.agent", lang)}
          </button>
          <button className={tab === "ui" ? "active" : ""} onClick={() => setTab("ui")}>
            {t("group.ui", lang)}
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="empty">…</div>
          ) : (
            <>
              {!secretsPersistent ? (
                <div className="warn-banner">{t("secrets.unavailable", lang)}</div>
              ) : null}
              {tab === "llm" ? (
                <LLMSettings
                  value={draft.llm}
                  onChange={(llm) => setDraft({ ...draft, llm })}
                  issues={issues}
                  lang={lang}
                  onTest={() => void handleTest()}
                  testing={testing}
                  testResult={testResult}
                />
              ) : null}
              {tab === "agent" ? (
                <AgentSettings
                  value={draft.agent}
                  onChange={(agent) => setDraft({ ...draft, agent })}
                  issues={issues}
                  lang={lang}
                />
              ) : null}
              {tab === "ui" ? (
                <UISettings value={draft.ui} onChange={(ui) => setDraft({ ...draft, ui })} lang={lang} />
              ) : null}
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="danger" onClick={() => void handleReset()}>
            {t("settings.reset", lang)}
          </button>
          <div className="row">
            <button onClick={handleCancel}>{t("settings.cancel", lang)}</button>
            <button
              className="primary"
              onClick={() => void handleSave()}
              disabled={saving || issues.length > 0}
            >
              {t("settings.save", lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
