import { useState } from "react";
import {
  PROVIDER_PRESETS,
  type LanguagePreference,
  type LLMProviderId,
  type LLMSettings as LLMSettingsValue,
  type TestConnectionResult,
  type ValidationIssue,
} from "@coding-agent/shared";
import { Field } from "./fields.js";
import { t } from "../../i18n.js";

const PROVIDER_OPTIONS: { id: LLMProviderId; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Google Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "custom", label: "Custom" },
];

type Props = {
  value: LLMSettingsValue;
  onChange: (next: LLMSettingsValue) => void;
  issues: ValidationIssue[];
  lang: LanguagePreference;
  onTest: () => void;
  testing: boolean;
  testResult: TestConnectionResult | null;
};

function errorFor(issues: ValidationIssue[], field: string): string | undefined {
  return issues.find((i) => i.field === field)?.message;
}

export function LLMSettings({
  value,
  onChange,
  issues,
  lang,
  onTest,
  testing,
  testResult,
}: Props): JSX.Element {
  const [showKey, setShowKey] = useState(false);

  const set = <K extends keyof LLMSettingsValue>(key: K, v: LLMSettingsValue[K]): void =>
    onChange({ ...value, [key]: v });

  const onProviderChange = (provider: LLMProviderId): void => {
    if (provider === "custom") {
      onChange({ ...value, provider });
      return;
    }
    const preset = PROVIDER_PRESETS[provider];
    // Autofill base URL + model to provider defaults when switching.
    onChange({ ...value, provider, baseUrl: preset.baseUrl, model: preset.defaultModel });
  };

  return (
    <div className="settings-group">
      <Field label={t("llm.provider", lang)} htmlFor="llm-provider">
        <select
          id="llm-provider"
          value={value.provider}
          onChange={(e) => onProviderChange(e.target.value as LLMProviderId)}
        >
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("llm.apiKey", lang)} hint={t("llm.apiKeyHint", lang)} htmlFor="llm-apikey">
        <div className="input-with-action">
          <input
            id="llm-apikey"
            type={showKey ? "text" : "password"}
            value={value.apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            onChange={(e) => set("apiKey", e.target.value)}
          />
          <button type="button" onClick={() => setShowKey((s) => !s)}>
            {showKey ? "🙈" : "👁"}
          </button>
        </div>
      </Field>

      <Field
        label={t("llm.baseUrl", lang)}
        error={errorFor(issues, "llm.baseUrl")}
        htmlFor="llm-baseurl"
      >
        <input
          id="llm-baseurl"
          type="text"
          value={value.baseUrl}
          spellCheck={false}
          onChange={(e) => set("baseUrl", e.target.value)}
        />
      </Field>

      <Field label={t("llm.model", lang)} error={errorFor(issues, "llm.model")} htmlFor="llm-model">
        <input
          id="llm-model"
          type="text"
          value={value.model}
          spellCheck={false}
          onChange={(e) => set("model", e.target.value)}
        />
      </Field>

      <div className="field-row">
        <Field
          label={t("llm.temperature", lang)}
          error={errorFor(issues, "llm.temperature")}
          htmlFor="llm-temp"
        >
          <input
            id="llm-temp"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={value.temperature}
            onChange={(e) => set("temperature", Number(e.target.value))}
          />
        </Field>

        <Field
          label={t("llm.maxTokens", lang)}
          error={errorFor(issues, "llm.maxTokens")}
          htmlFor="llm-maxtokens"
        >
          <input
            id="llm-maxtokens"
            type="number"
            min={1}
            step={1}
            value={value.maxTokens}
            onChange={(e) => set("maxTokens", Number(e.target.value))}
          />
        </Field>

        <Field
          label={t("llm.timeout", lang)}
          error={errorFor(issues, "llm.timeoutSeconds")}
          htmlFor="llm-timeout"
        >
          <input
            id="llm-timeout"
            type="number"
            min={1}
            step={1}
            value={value.timeoutSeconds}
            onChange={(e) => set("timeoutSeconds", Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="row test-row">
        <button type="button" onClick={onTest} disabled={testing}>
          {testing ? t("llm.testing", lang) : t("llm.test", lang)}
        </button>
        {testResult ? (
          <span className={testResult.ok ? "test-ok" : "test-fail"}>{testResult.message}</span>
        ) : null}
      </div>
    </div>
  );
}
