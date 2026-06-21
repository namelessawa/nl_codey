import { useState } from "react";
import type { LanguagePreference } from "@nlc/shared";
import { Icon } from "./Icons.js";
import { IntelligencePanel } from "./IntelligencePanel.js";
import { AdvancedPanel } from "./AdvancedPanel.js";
import { t } from "../i18n.js";

type WorkbenchTab = "phase3" | "phase4";

interface WorkbenchModalProps {
  open: boolean;
  /** May be null when no workspace is open. Phase 4 panels still work without one. */
  workspaceId: string | null;
  /** Active run id — drives the task tree, role timeline and git diff inside Phase 3. */
  runId: string | null;
  lang: LanguagePreference;
  onClose: () => void;
}

/**
 * Single entry point into the long-term memory / multi-agent / Phase 4 surface.
 * Reuses the SettingsModal frame (scrim + container shape) so visual language is
 * consistent. The two stage-panels are mounted lazily by tab to keep mount cost
 * predictable when the user only opens one of them.
 */
export function WorkbenchModal({
  open,
  workspaceId,
  runId,
  lang,
  onClose,
}: WorkbenchModalProps): JSX.Element | null {
  const [tab, setTab] = useState<WorkbenchTab>("phase3");

  if (!open) return null;

  const title = t("topbar.workbench", lang);
  const tabs: { id: WorkbenchTab; label: string; sub: string }[] = [
    { id: "phase3", label: "Phase 3", sub: "memory · tasks · roles · git · failures" },
    { id: "phase4", label: "Phase 4", sub: "KG · style · learning · finetune · proposals · cluster · plugins" },
  ];

  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(1080px, 100%)" }}
      >
        <header className="sm-head">
          <div className="sm-head-l">
            <span className="sm-eyebrow">codey · workbench</span>
            <h2 className="sm-title">{title}</h2>
          </div>
          <button className="sm-close" type="button" onClick={onClose} aria-label="close">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 16px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {tabs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setTab(d.id)}
              aria-pressed={tab === d.id}
              style={{
                background: tab === d.id ? "var(--surface-2)" : "transparent",
                border: "1px solid",
                borderColor: tab === d.id ? "var(--border)" : "transparent",
                borderBottomColor: tab === d.id ? "var(--surface-2)" : "transparent",
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
                padding: "10px 14px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "var(--mono)",
                fontSize: 12,
                color: tab === d.id ? "var(--ink)" : "var(--muted)",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ fontWeight: 600 }}>{d.label}</span>
              <span style={{ fontSize: 10, opacity: 0.8 }}>{d.sub}</span>
            </button>
          ))}
        </div>

        <section
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            background: "var(--surface)",
          }}
        >
          {tab === "phase3" ? (
            workspaceId ? (
              <IntelligencePanel workspaceId={workspaceId} runId={runId} />
            ) : (
              <div
                style={{
                  padding: 48,
                  textAlign: "center",
                  fontFamily: "var(--serif)",
                  fontSize: 14,
                  color: "var(--muted)",
                }}
              >
                先打开一个工作区，才能访问长期记忆、任务树和角色时间线。
              </div>
            )
          ) : (
            <AdvancedPanel workspaceId={workspaceId} />
          )}
        </section>
      </div>
    </div>
  );
}
