import { useState } from "react";
import {
  PROVIDER_PRESETS,
  type LanguagePreference,
  type LLMProviderId,
  type LLMSettings as LLMSettingsValue,
  type TestConnectionResult,
  type ValidationIssue,
} from "@coding-agent/shared";
import { Field, NumInput } from "./fields.js";
import { Icon } from "../Icons.js";
import { t } from "../../i18n.js";

type ProviderMeta = {
  id: LLMProviderId;
  label: string;
  mark: string;
};

const PROVIDERS: ProviderMeta[] = [
  { id: "openai", label: "OpenAI", mark: "o" },
  { id: "anthropic", label: "Anthropic", mark: "A" },
  { id: "gemini", label: "Google Gemini", mark: "G" },
  { id: "deepseek", label: "DeepSeek", mark: "D" },
  { id: "openrouter", label: "OpenRouter", mark: "⌥" },
  { id: "custom", label: "Custom", mark: "…" },
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

  const onProvider = (provider: LLMProviderId): void => {
    if (provider === "custom") {
      onChange({ ...value, provider });
      return;
    }
    const preset = PROVIDER_PRESETS[provider];
    onChange({ ...value, provider, baseUrl: preset.baseUrl, model: preset.defaultModel });
  };

  return (
    <div className="pane">
      <header className="pane-head">
        <h3>{t("llm.paneTitle", lang)}</h3>
        <p>{t("llm.paneIntro", lang)}</p>
      </header>

      <Field label={t("llm.provider", lang)}>
        <div className="provider-grid">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`provider${value.provider === p.id ? " active" : ""}`}
              onClick={() => onProvider(p.id)}
            >
              <span className={`provider-mark mk-${p.id}`}>{p.mark}</span>
              <span className="provider-label">{p.label}</span>
              {value.provider === p.id && (
                <Icon
                  name="check"
                  size={13}
                  stroke={2.4}
                  style={{ marginLeft: "auto", color: "var(--green)" }}
                />
              )}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("llm.apiKey", lang)} hint={t("llm.apiKeyHint", lang)} htmlFor="llm-apikey">
        <div className="input-action">
          <input
            id="llm-apikey"
            type={showKey ? "text" : "password"}
            value={value.apiKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-… · leave blank to use .env fallback"
            onChange={(e) => set("apiKey", e.target.value)}
          />
          <button
            type="button"
            className="btn ghost"
            onClick={() => setShowKey((s) => !s)}
            title={showKey ? "Hide" : "Show"}
          >
            <Icon name={showKey ? "x" : "doc"} size={14} />
          </button>
        </div>
      </Field>

      <div className="fld-row">
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

        <Field
          label={t("llm.model", lang)}
          error={errorFor(issues, "llm.model")}
          htmlFor="llm-model"
        >
          <input
            id="llm-model"
            type="text"
            value={value.model}
            spellCheck={false}
            onChange={(e) => set("model", e.target.value)}
          />
        </Field>
      </div>

      <div className="fld-row">
        <Field
          label={t("llm.temperature", lang)}
          hint="0–2"
          error={errorFor(issues, "llm.temperature")}
          htmlFor="llm-temp"
        >
          <NumInput
            id="llm-temp"
            value={value.temperature}
            min={0}
            max={2}
            step={0.1}
            onChange={(v) => set("temperature", v)}
          />
        </Field>
        <Field
          label={t("llm.maxTokens", lang)}
          error={errorFor(issues, "llm.maxTokens")}
          htmlFor="llm-maxtokens"
        >
          <NumInput
            id="llm-maxtokens"
            value={value.maxTokens}
            min={1}
            step={1}
            onChange={(v) => set("maxTokens", v)}
          />
        </Field>
        <Field
          label={t("llm.timeout", lang)}
          error={errorFor(issues, "llm.timeoutSeconds")}
          htmlFor="llm-timeout"
        >
          <NumInput
            id="llm-timeout"
            value={value.timeoutSeconds}
            min={1}
            step={1}
            suffix="s"
            onChange={(v) => set("timeoutSeconds", v)}
          />
        </Field>
      </div>

      <div className="test-row-new">
        <button type="button" className="btn" onClick={onTest} disabled={testing}>
          {testing ? (
            <>
              <span className="spinner" /> {t("llm.testing", lang)}
            </>
          ) : (
            <>
              <Icon name="send" size={12} stroke={2.2} /> {t("llm.test", lang)}
            </>
          )}
        </button>
        {testResult && testResult.ok && (
          <span className="test-result ok">
            <Icon name="check" size={13} stroke={2.4} />
            {testResult.message}
          </span>
        )}
        {testResult && !testResult.ok && (
          <span className="test-result fail">
            <Icon name="x" size={13} stroke={2.4} />
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
