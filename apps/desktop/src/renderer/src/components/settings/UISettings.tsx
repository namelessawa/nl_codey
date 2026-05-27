import type {
  FontSizePreference,
  LanguagePreference,
  ThemePreference,
  UISettings as UISettingsValue,
} from "@coding-agent/shared";
import { Field } from "./fields.js";
import { t } from "../../i18n.js";

type Props = {
  value: UISettingsValue;
  onChange: (next: UISettingsValue) => void;
  lang: LanguagePreference;
};

export function UISettings({ value, onChange, lang }: Props): JSX.Element {
  const set = <K extends keyof UISettingsValue>(key: K, v: UISettingsValue[K]): void =>
    onChange({ ...value, [key]: v });

  return (
    <div className="settings-group">
      <Field label={t("ui.theme", lang)} htmlFor="ui-theme">
        <select
          id="ui-theme"
          value={value.theme}
          onChange={(e) => set("theme", e.target.value as ThemePreference)}
        >
          <option value="system">{t("ui.theme.system", lang)}</option>
          <option value="light">{t("ui.theme.light", lang)}</option>
          <option value="dark">{t("ui.theme.dark", lang)}</option>
        </select>
      </Field>

      <Field label={t("ui.language", lang)} htmlFor="ui-language">
        <select
          id="ui-language"
          value={value.language}
          onChange={(e) => set("language", e.target.value as LanguagePreference)}
        >
          <option value="zh-CN">zh-CN</option>
          <option value="en-US">en-US</option>
        </select>
      </Field>

      <Field label={t("ui.fontSize", lang)} htmlFor="ui-fontsize">
        <select
          id="ui-fontsize"
          value={value.fontSize}
          onChange={(e) => set("fontSize", e.target.value as FontSizePreference)}
        >
          <option value="small">{t("ui.fontSize.small", lang)}</option>
          <option value="medium">{t("ui.fontSize.medium", lang)}</option>
          <option value="large">{t("ui.fontSize.large", lang)}</option>
        </select>
      </Field>
    </div>
  );
}
