import type {
  AgentSettings as AgentSettingsValue,
  LanguagePreference,
  ValidationIssue,
} from "@coding-agent/shared";
import { Field, Toggle } from "./fields.js";
import { t } from "../../i18n.js";

type Props = {
  value: AgentSettingsValue;
  onChange: (next: AgentSettingsValue) => void;
  issues: ValidationIssue[];
  lang: LanguagePreference;
};

export function AgentSettings({ value, onChange, issues, lang }: Props): JSX.Element {
  const set = <K extends keyof AgentSettingsValue>(key: K, v: AgentSettingsValue[K]): void =>
    onChange({ ...value, [key]: v });

  const maxStepsError = issues.find((i) => i.field === "agent.maxAutoSteps")?.message;

  return (
    <div className="settings-group">
      <Field label={t("agent.workspacePath", lang)} htmlFor="agent-workspace">
        <input
          id="agent-workspace"
          type="text"
          value={value.workspacePath}
          spellCheck={false}
          placeholder="C:\\path\\to\\project"
          onChange={(e) => set("workspacePath", e.target.value)}
        />
      </Field>

      <Toggle
        id="agent-allow-shell"
        label={t("agent.allowShell", lang)}
        checked={value.allowShellExecution}
        onChange={(c) => set("allowShellExecution", c)}
      />
      <Toggle
        id="agent-require-confirm"
        label={t("agent.requireConfirm", lang)}
        checked={value.requireConfirmationBeforeCommand}
        onChange={(c) => set("requireConfirmationBeforeCommand", c)}
      />
      <Toggle
        id="agent-sandbox"
        label={t("agent.sandbox", lang)}
        checked={value.sandboxEnabled}
        onChange={(c) => set("sandboxEnabled", c)}
      />

      <Field label={t("agent.maxAutoSteps", lang)} error={maxStepsError} htmlFor="agent-maxsteps">
        <input
          id="agent-maxsteps"
          type="number"
          min={1}
          step={1}
          value={value.maxAutoSteps}
          onChange={(e) => set("maxAutoSteps", Number(e.target.value))}
        />
      </Field>
    </div>
  );
}
