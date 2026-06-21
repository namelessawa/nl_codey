import { useCallback, useEffect, useState } from "react";
import type {
  AppSettings,
  DensityPreference,
  FontSizePreference,
  LanguagePreference,
  ThemePreference,
  UISettings as UISettingsValue,
} from "@nlc/shared";
import { api } from "../api.js";
import { applyAppearance } from "../appearance.js";
import { Field, Segmented } from "./settings/fields.js";
import { Icon } from "./Icons.js";
import { t } from "../i18n.js";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpenFullSettings: () => void;
  onSaved: (settings: AppSettings) => void;
  onToast: (kind: "success" | "error", text: string) => void;
};

/**
 * Sidebar-anchored quick preferences popover. Edits a local draft and saves
 * via api.updateSettings on every change so the popover acts like an autosave
 * surface — matches the design's "saved automatically" footer.
 */
export function QuickPrefsPopover({
  open,
  onClose,
  onOpenFullSettings,
  onSaved,
  onToast,
}: Props): JSX.Element | null {
  const [draft, setDraft] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .getSettings()
      .then((payload) => {
        if (!cancelled) setDraft(payload.settings);
      })
      .catch(() => {
        /* leave draft null; UI shows defaults */
      });
    return (): void => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const saveUI = useCallback(
    async (nextUi: UISettingsValue) => {
      if (!draft) return;
      const next: AppSettings = { ...draft, ui: nextUi };
      setDraft(next);
      // Apply immediately for instant feedback; persist in the background.
      applyAppearance(nextUi);
      try {
        const payload = await api.updateSettings(next);
        onSaved(payload.settings);
      } catch (err) {
        onToast("error", err instanceof Error ? err.message : String(err));
      }
    },
    [draft, onSaved, onToast],
  );

  if (!open) return null;
  const lang = draft?.ui.language ?? "zh-CN";
  const ui = draft?.ui;

  return (
    <>
      <div className="pop-scrim" onClick={onClose} />
      <div className="pop pop-sidebar" role="dialog" aria-label={t("quickprefs.title", lang)}>
        <div className="pop-arrow" />
        <div className="pop-head">
          <span className="pop-eyebrow">{t("quickprefs.title", lang)}</span>
          <span className="pop-mono">Ctrl+,</span>
        </div>

        <div className="pop-body">
          {ui ? (
            <>
              <Field label={t("ui.theme", lang)}>
                <Segmented<ThemePreference>
                  value={ui.theme}
                  onChange={(v) => void saveUI({ ...ui, theme: v })}
                  options={[
                    { value: "light", label: t("ui.theme.light", lang) },
                    { value: "dark", label: t("ui.theme.dark", lang) },
                    { value: "system", label: t("ui.theme.system", lang) },
                  ]}
                />
              </Field>

              <Field label={t("ui.language", lang)}>
                <Segmented<LanguagePreference>
                  value={ui.language}
                  onChange={(v) => void saveUI({ ...ui, language: v })}
                  options={[
                    { value: "zh-CN", label: "中文" },
                    { value: "en-US", label: "English" },
                  ]}
                />
              </Field>

              <Field label={t("ui.fontSize", lang)}>
                <Segmented<FontSizePreference>
                  value={ui.fontSize}
                  onChange={(v) => void saveUI({ ...ui, fontSize: v })}
                  options={[
                    { value: "small", label: "S" },
                    { value: "medium", label: "M" },
                    { value: "large", label: "L" },
                  ]}
                />
              </Field>

              <Field label={t("ui.density", lang)}>
                <Segmented<DensityPreference>
                  value={ui.density}
                  onChange={(v) => void saveUI({ ...ui, density: v })}
                  options={[
                    { value: "comfy", label: t("ui.density.comfy", lang) },
                    { value: "compact", label: t("ui.density.compact", lang) },
                  ]}
                />
              </Field>
            </>
          ) : (
            <div className="empty" style={{ padding: 12 }}>…</div>
          )}
        </div>

        <div className="pop-foot">
          <button
            type="button"
            className="link"
            onClick={() => {
              onClose();
              onOpenFullSettings();
            }}
          >
            {t("quickprefs.allSettings", lang)}
            <Icon name="chev-right" size={12} stroke={2} />
          </button>
          <span className="pop-foot-mono">{t("quickprefs.autosave", lang)}</span>
        </div>
      </div>
    </>
  );
}
