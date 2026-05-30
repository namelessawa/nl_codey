import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SHORTCUTS,
  type LanguagePreference,
  type ShortcutBindings,
} from "@coding-agent/shared";
import { Icon } from "../Icons.js";
import { t } from "../../i18n.js";

type Props = {
  value: ShortcutBindings;
  onChange: (next: ShortcutBindings) => void;
  lang: LanguagePreference;
};

type ShortcutItem = {
  id: string;
  label: string;
  hint: string;
};

type ShortcutGroup = {
  section: string;
  items: ShortcutItem[];
};

function buildCatalog(lang: LanguagePreference): ShortcutGroup[] {
  return [
    {
      section: t("shortcuts.group.workflow", lang),
      items: [
        { id: "new-run", label: t("shortcuts.newRun", lang), hint: t("shortcuts.newRunHint", lang) },
        {
          id: "open-workspace",
          label: t("shortcuts.openWorkspace", lang),
          hint: t("shortcuts.openWorkspaceHint", lang),
        },
        {
          id: "send-message",
          label: t("shortcuts.sendMessage", lang),
          hint: t("shortcuts.sendMessageHint", lang),
        },
        {
          id: "stop-run",
          label: t("shortcuts.stopRun", lang),
          hint: t("shortcuts.stopRunHint", lang),
        },
        {
          id: "recall-last",
          label: t("shortcuts.recallLast", lang),
          hint: t("shortcuts.recallLastHint", lang),
        },
      ],
    },
    {
      section: t("shortcuts.group.approval", lang),
      items: [
        {
          id: "approve-patch",
          label: t("shortcuts.approvePatch", lang),
          hint: t("shortcuts.approvePatchHint", lang),
        },
        {
          id: "reject-patch",
          label: t("shortcuts.rejectPatch", lang),
          hint: t("shortcuts.rejectPatchHint", lang),
        },
        {
          id: "open-diff",
          label: t("shortcuts.openDiff", lang),
          hint: t("shortcuts.openDiffHint", lang),
        },
        {
          id: "rollback",
          label: t("shortcuts.rollback", lang),
          hint: t("shortcuts.rollbackHint", lang),
        },
      ],
    },
    {
      section: t("shortcuts.group.nav", lang),
      items: [
        {
          id: "palette",
          label: t("shortcuts.palette", lang),
          hint: t("shortcuts.paletteHint", lang),
        },
        {
          id: "search-history",
          label: t("shortcuts.searchHistory", lang),
          hint: t("shortcuts.searchHistoryHint", lang),
        },
        {
          id: "next-thread",
          label: t("shortcuts.nextThread", lang),
          hint: t("shortcuts.nextThreadHint", lang),
        },
        {
          id: "prev-thread",
          label: t("shortcuts.prevThread", lang),
          hint: t("shortcuts.prevThreadHint", lang),
        },
      ],
    },
    {
      section: t("shortcuts.group.app", lang),
      items: [
        {
          id: "quick-prefs",
          label: t("shortcuts.quickPrefs", lang),
          hint: t("shortcuts.quickPrefsHint", lang),
        },
        {
          id: "open-settings",
          label: t("shortcuts.openSettings", lang),
          hint: t("shortcuts.openSettingsHint", lang),
        },
      ],
    },
  ];
}

function formatCombo(combo: string): string[] {
  if (!combo) return [];
  return combo.split("+").map((p) =>
    p
      .replace("ArrowUp", "↑")
      .replace("ArrowDown", "↓")
      .replace("ArrowLeft", "←")
      .replace("ArrowRight", "→")
      .replace("Enter", "↵")
      .replace("Backspace", "⌫")
      .replace("Escape", "Esc"),
  );
}

function captureKey(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  const k = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(k)) return null;
  let key = k;
  if (k === " ") key = "Space";
  if (k.length === 1) key = k.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

function detectConflicts(bindings: ShortcutBindings): Record<string, string[]> {
  const seen: Record<string, string[]> = {};
  for (const [id, combo] of Object.entries(bindings)) {
    if (!combo) continue;
    seen[combo] = seen[combo] ?? [];
    seen[combo].push(id);
  }
  const out: Record<string, string[]> = {};
  for (const ids of Object.values(seen)) {
    if (ids.length > 1) {
      for (const id of ids) {
        out[id] = ids.filter((x) => x !== id);
      }
    }
  }
  return out;
}

export function ShortcutsPane({ value, onChange, lang }: Props): JSX.Element {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => buildCatalog(lang), [lang]);
  const conflicts = useMemo(() => detectConflicts(value), [value]);
  const hasConflicts = Object.keys(conflicts).length > 0;

  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingId(null);
        return;
      }
      const combo = captureKey(e);
      if (!combo) return;
      onChange({ ...value, [recordingId]: combo });
      setRecordingId(null);
    };
    window.addEventListener("keydown", onKey, true);
    return (): void => window.removeEventListener("keydown", onKey, true);
  }, [recordingId, value, onChange]);

  const resetAll = (): void => {
    if (window.confirm(t("shortcuts.resetConfirm", lang))) {
      onChange({ ...DEFAULT_SHORTCUTS });
    }
  };

  const filterFn = (item: ShortcutItem): boolean => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      item.hint.toLowerCase().includes(q) ||
      (value[item.id] ?? "").toLowerCase().includes(q)
    );
  };

  return (
    <div className="pane">
      <header className="pane-head">
        <h3>{t("shortcuts.paneTitle", lang)}</h3>
        <p>{t("shortcuts.paneIntro", lang)}</p>
      </header>

      <div className="sc-toolbar">
        <div className="input-action" style={{ flex: 1 }}>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("shortcuts.filterPlaceholder", lang)}
          />
        </div>
        <button type="button" className="btn" onClick={resetAll}>
          <Icon name="undo" size={13} stroke={2} style={{ marginRight: 4 }} />
          {t("shortcuts.resetAll", lang)}
        </button>
      </div>

      {hasConflicts && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 12px",
            background: "var(--red-soft)",
            color: "var(--red)",
            borderRadius: 7,
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          <Icon name="x" size={13} stroke={2.4} />
          <span>{t("shortcuts.conflictBanner", lang)}</span>
        </div>
      )}

      <div className="sc-groups">
        {groups.map((group) => {
          const items = group.items.filter(filterFn);
          if (items.length === 0) return null;
          return (
            <section key={group.section} className="sc-group">
              <div className="sc-group-head">{group.section}</div>
              <ul className="sc-list">
                {items.map((it) => {
                  const combo = value[it.id] ?? "";
                  const isRec = recordingId === it.id;
                  const conf = conflicts[it.id];
                  const isDefault = combo === (DEFAULT_SHORTCUTS[it.id] ?? "");
                  const parts = formatCombo(combo);
                  return (
                    <li
                      key={it.id}
                      className="sc-row"
                      style={{
                        gridTemplateColumns: "1fr auto auto",
                        background: isRec
                          ? "color-mix(in srgb, var(--accent) 8%, var(--surface))"
                          : conf
                            ? "color-mix(in srgb, var(--red) 6%, var(--surface))"
                            : undefined,
                      }}
                    >
                      <div className="sc-row-text">
                        <span className="sc-row-label">{it.label}</span>
                        <span className="sc-row-hint">
                          {it.hint}
                          {conf && (
                            <span style={{ color: "var(--red)" }}>
                              {" · "}
                              {t("shortcuts.alsoBoundTo", lang)} <strong>{conf.join(", ")}</strong>
                            </span>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRecordingId(isRec ? null : it.id)}
                        style={{
                          border: "1px solid",
                          borderColor: isRec
                            ? "var(--accent)"
                            : conf
                              ? "var(--red)"
                              : "var(--border)",
                          background: isRec ? "var(--accent-soft)" : "var(--surface)",
                          borderRadius: 6,
                          padding: "4px 8px",
                          cursor: "pointer",
                          minWidth: 130,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {isRec ? (
                          <span
                            className="kb-disp"
                            style={{ color: "var(--accent)", gap: 8 }}
                          >
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 99,
                                background: "var(--accent)",
                                boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 24%, transparent)",
                                animation: "pulse 1.2s ease-in-out infinite",
                              }}
                            />
                            <span>{t("shortcuts.pressKeys", lang)}</span>
                          </span>
                        ) : combo ? (
                          <span className="kb-disp">
                            {parts.map((p, i) => (
                              <span
                                key={i}
                                style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                              >
                                <span className="kb-chip">{p}</span>
                                {i < parts.length - 1 && <span className="kb-plus">+</span>}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="kb-disp empty">{t("shortcuts.unbound", lang)}</span>
                        )}
                      </button>
                      <div
                        style={{
                          display: "flex",
                          gap: 2,
                          alignItems: "center",
                          width: 56,
                          justifyContent: "flex-end",
                        }}
                      >
                        {!isDefault && (
                          <button
                            type="button"
                            className="btn ghost"
                            title={t("shortcuts.resetOne", lang)}
                            onClick={() =>
                              onChange({
                                ...value,
                                [it.id]: DEFAULT_SHORTCUTS[it.id] ?? "",
                              })
                            }
                            style={{ padding: 4, width: 24, height: 24, color: "var(--muted)" }}
                          >
                            <Icon name="undo" size={12} stroke={2} />
                          </button>
                        )}
                        {combo && (
                          <button
                            type="button"
                            className="btn ghost"
                            title={t("shortcuts.unbind", lang)}
                            onClick={() => onChange({ ...value, [it.id]: "" })}
                            style={{ padding: 4, width: 24, height: 24, color: "var(--muted)" }}
                          >
                            <Icon name="x" size={12} stroke={2} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
