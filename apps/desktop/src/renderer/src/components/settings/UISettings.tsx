import type {
  DensityPreference,
  FontSizePreference,
  LanguagePreference,
  ThemePreference,
  UISettings as UISettingsValue,
} from "@coding-agent/shared";
import { Field, Segmented, ToggleRow } from "./fields.js";
import { t } from "../../i18n.js";

type Props = {
  value: UISettingsValue;
  onChange: (next: UISettingsValue) => void;
  lang: LanguagePreference;
};

type ThemeCardData = {
  id: ThemePreference;
  label: string;
  swatch: [string, string, string];
  split?: boolean;
};

export function UISettings({ value, onChange, lang }: Props): JSX.Element {
  const set = <K extends keyof UISettingsValue>(key: K, v: UISettingsValue[K]): void =>
    onChange({ ...value, [key]: v });

  const themes: ThemeCardData[] = [
    { id: "light", label: t("ui.theme.light", lang), swatch: ["#faf8f4", "#181612", "#b87a2a"] },
    { id: "dark", label: t("ui.theme.dark", lang), swatch: ["#14130f", "#ecebe6", "#d4a45f"] },
    {
      id: "system",
      label: t("ui.theme.system", lang),
      swatch: ["#faf8f4", "#14130f", "#b87a2a"],
      split: true,
    },
  ];

  return (
    <div className="pane">
      <header className="pane-head">
        <h3>{t("ui.paneTitle", lang)}</h3>
        <p>{t("ui.paneIntro", lang)}</p>
      </header>

      <Field label={t("ui.theme", lang)}>
        <div className="theme-grid">
          {themes.map((tc) => (
            <button
              key={tc.id}
              type="button"
              className={`theme-card${value.theme === tc.id ? " active" : ""}`}
              onClick={() => set("theme", tc.id)}
            >
              <div
                className={`theme-swatch${tc.split ? " split" : ""}`}
                style={
                  {
                    "--c1": tc.swatch[0],
                    "--c2": tc.swatch[1],
                    "--c3": tc.swatch[2],
                  } as React.CSSProperties
                }
              >
                <span className="ts-ink" />
                <span className="ts-accent" />
              </div>
              <span className="theme-label">{tc.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="fld-row">
        <Field label={t("ui.language", lang)}>
          <Segmented<LanguagePreference>
            value={value.language}
            onChange={(v) => set("language", v)}
            options={[
              { value: "zh-CN", label: "中文" },
              { value: "en-US", label: "English" },
            ]}
          />
        </Field>

        <Field label={t("ui.fontSize", lang)}>
          <Segmented<FontSizePreference>
            value={value.fontSize}
            onChange={(v) => set("fontSize", v)}
            options={[
              { value: "small", label: t("ui.fontSize.small", lang) },
              { value: "medium", label: t("ui.fontSize.medium", lang) },
              { value: "large", label: t("ui.fontSize.large", lang) },
            ]}
          />
        </Field>
      </div>

      <Field label={t("ui.density", lang)} hint={t("ui.densityHint", lang)}>
        <Segmented<DensityPreference>
          value={value.density}
          onChange={(v) => set("density", v)}
          options={[
            { value: "comfy", label: t("ui.density.comfy", lang) },
            { value: "compact", label: t("ui.density.compact", lang) },
          ]}
        />
      </Field>

      <div className="fld-stack toggle-stack">
        <ToggleRow
          id="ui-pipeline"
          checked={value.showPipeline}
          onChange={(c) => set("showPipeline", c)}
          label={t("ui.pipeline", lang)}
          hint={t("ui.pipelineHint", lang)}
        />
        <ToggleRow
          id="ui-anims"
          checked={!value.reduceMotion}
          onChange={(c) => set("reduceMotion", !c)}
          label={t("ui.motion", lang)}
          hint={t("ui.motionHint", lang)}
        />
        <ToggleRow
          id="ui-smooth"
          checked={value.smoothTransitions && !value.reduceMotion}
          onChange={(c) => set("smoothTransitions", c)}
          label={t("ui.smoothTransitions", lang)}
          hint={t("ui.smoothTransitionsHint", lang)}
        />
      </div>
    </div>
  );
}
