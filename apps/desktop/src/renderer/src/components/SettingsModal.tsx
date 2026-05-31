import { useEffect, useState } from "react";
import type { AppSettings, InstallationStatus, TestConnectionResult } from "@coding-agent/shared";
import { useSettings } from "../hooks/useSettings.js";
import { t } from "../i18n.js";
import { Icon } from "./Icons.js";
import { LLMSettings } from "./settings/LLMSettings.js";
import { AgentSettings } from "./settings/AgentSettings.js";
import { UISettings } from "./settings/UISettings.js";
import { ShortcutsPane } from "./settings/ShortcutsPane.js";

export type SettingsTab = "llm" | "agent" | "ui" | "shortcuts";

type Props = {
  open: boolean;
  initialTab?: SettingsTab;
  /** Docker availability + skip choice; drives the Agent panel lock-out. */
  installation: InstallationStatus;
  /** Re-open the Docker install modal from the locked Agent panel banner. */
  onRequestDockerInstall: () => void;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
  onToast: (kind: "success" | "error", text: string) => void;
};

export function SettingsModal({
  open,
  initialTab = "llm",
  installation,
  onRequestDockerInstall,
  onClose,
  onSaved,
  onToast,
}: Props): JSX.Element | null {
  const { draft, loading, secretsPersistent, issues, setDraft, reload, save, reset, testConnection } =
    useSettings();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const lang = draft.ui.language;

  useEffect(() => {
    if (open) {
      void reload();
      setTestResult(null);
      setTab(initialTab);
      setDirty(false);
    }
  }, [open, reload, initialTab]);

  if (!open) return null;

  const handleSetDraft = (next: AppSettings): void => {
    setDirty(true);
    setDraft(next);
  };

  const handleCancel = (): void => {
    void reload();
    setDirty(false);
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
      setDirty(false);
      setLastSavedAt(new Date());
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
      setDirty(false);
      setLastSavedAt(new Date());
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

  const tabs: Array<{
    id: SettingsTab;
    icon: Parameters<typeof Icon>[0]["name"];
    label: string;
    hint: string;
  }> = [
    {
      id: "llm",
      icon: "sparkle",
      label: t("group.llm", lang),
      hint: t("settings.tab.llm.hint", lang),
    },
    {
      id: "agent",
      icon: "gear",
      label: t("group.agent", lang),
      hint: t("settings.tab.agent.hint", lang),
    },
    {
      id: "ui",
      icon: "doc",
      label: t("group.ui", lang),
      hint: t("settings.tab.ui.hint", lang),
    },
    {
      id: "shortcuts",
      icon: "search",
      label: t("settings.tab.shortcuts", lang),
      hint: t("settings.tab.shortcuts.hint", lang),
    },
  ];

  const savedTimeLabel = lastSavedAt
    ? lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="modal-scrim" onMouseDown={handleCancel}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title", lang)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sm-head">
          <div className="sm-head-l">
            <span className="sm-eyebrow">{t("settings.eyebrow", lang)}</span>
            <h2 className="sm-title">{t("settings.title", lang)}</h2>
          </div>
          <button
            className="sm-close"
            type="button"
            onClick={handleCancel}
            aria-label={t("settings.cancel", lang)}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="sm-body">
          <nav className="sm-tabs" role="tablist">
            {tabs.map((tabDef) => (
              <button
                key={tabDef.id}
                role="tab"
                aria-selected={tab === tabDef.id}
                className={`sm-tab${tab === tabDef.id ? " active" : ""}`}
                onClick={() => setTab(tabDef.id)}
                type="button"
              >
                <span className="sm-tab-icon">
                  <Icon name={tabDef.icon} size={15} />
                </span>
                <span className="sm-tab-text">
                  <span className="sm-tab-label">{tabDef.label}</span>
                  <span className="sm-tab-hint">{tabDef.hint}</span>
                </span>
              </button>
            ))}

            <div className="sm-tab-foot">
              <div className="storage-note">
                <Icon name="check" size={13} stroke={2} />
                <div>
                  <strong>{t("settings.storage.title", lang)}</strong>
                  <span>{t("settings.storage.body", lang)}</span>
                </div>
              </div>
            </div>
          </nav>

          <section className="sm-content">
            {loading ? (
              <div className="empty">…</div>
            ) : (
              <>
                {!secretsPersistent ? (
                  <div className="warn-banner" style={{ marginBottom: 16 }}>
                    {t("secrets.unavailable", lang)}
                  </div>
                ) : null}

                {tab === "llm" && (
                  <LLMSettings
                    value={draft.llm}
                    onChange={(llm) => handleSetDraft({ ...draft, llm })}
                    issues={issues}
                    lang={lang}
                    onTest={() => void handleTest()}
                    testing={testing}
                    testResult={testResult}
                  />
                )}
                {tab === "agent" && (
                  <AgentSettings
                    value={draft.agent}
                    onChange={(agent) => handleSetDraft({ ...draft, agent })}
                    issues={issues}
                    lang={lang}
                    installation={installation}
                    onRequestInstall={onRequestDockerInstall}
                  />
                )}
                {tab === "ui" && (
                  <UISettings
                    value={draft.ui}
                    onChange={(ui) => handleSetDraft({ ...draft, ui })}
                    lang={lang}
                  />
                )}
                {tab === "shortcuts" && (
                  <ShortcutsPane
                    value={draft.shortcuts}
                    onChange={(shortcuts) => handleSetDraft({ ...draft, shortcuts })}
                    lang={lang}
                  />
                )}
              </>
            )}
          </section>
        </div>

        <footer className="sm-foot">
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => void handleReset()}
          >
            {t("settings.reset", lang)}
          </button>
          <span className="sm-foot-status">
            {dirty ? (
              <span className="dirty">
                <span className="dot" /> {t("settings.unsaved", lang)}
              </span>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                {t("settings.allSaved", lang)}
                {savedTimeLabel ? ` · ${savedTimeLabel}` : ""}
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={handleCancel}>
            {t("settings.cancel", lang)}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={saving || issues.length > 0 || !dirty}
            style={{
              opacity: !dirty || saving || issues.length > 0 ? 0.55 : 1,
              cursor: !dirty || saving || issues.length > 0 ? "not-allowed" : "pointer",
            }}
          >
            {t("settings.save", lang)}
          </button>
        </footer>
      </div>
    </div>
  );
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
