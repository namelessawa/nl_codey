import type {
  AgentSettings as AgentSettingsValue,
  LanguagePreference,
  SandboxMode,
  ValidationIssue,
} from "@coding-agent/shared";
import { Field, NumInput, ToggleRow } from "./fields.js";
import { Icon } from "../Icons.js";
import { t } from "../../i18n.js";

type Props = {
  value: AgentSettingsValue;
  onChange: (next: AgentSettingsValue) => void;
  issues: ValidationIssue[];
  lang: LanguagePreference;
};

type SandboxCard = {
  id: SandboxMode;
  title: string;
  tag: string;
  body: string;
};

function errorFor(issues: ValidationIssue[], field: string): string | undefined {
  return issues.find((i) => i.field === field)?.message;
}

export function AgentSettings({ value, onChange, issues, lang }: Props): JSX.Element {
  const set = <K extends keyof AgentSettingsValue>(key: K, v: AgentSettingsValue[K]): void =>
    onChange({ ...value, [key]: v });

  const cards: SandboxCard[] = [
    {
      id: "whitelist",
      title: t("agent.sandbox.whitelist", lang),
      tag: t("agent.sandbox.whitelistTag", lang),
      body: t("agent.sandbox.whitelistBody", lang),
    },
    {
      id: "wsl",
      title: "WSL",
      tag: t("agent.sandbox.wslTag", lang),
      body: t("agent.sandbox.wslBody", lang),
    },
    {
      id: "docker",
      title: "Docker",
      tag: t("agent.sandbox.dockerTag", lang),
      body: t("agent.sandbox.dockerBody", lang),
    },
  ];

  return (
    <div className="pane">
      <header className="pane-head">
        <h3>{t("agent.paneTitle", lang)}</h3>
        <p>{t("agent.paneIntro", lang)}</p>
      </header>

      <Field
        label={t("agent.workspacePath", lang)}
        hint={t("agent.workspacePathHint", lang)}
        htmlFor="agent-workspace"
      >
        <div className="input-action">
          <input
            id="agent-workspace"
            type="text"
            value={value.workspacePath}
            spellCheck={false}
            placeholder="C:\\path\\to\\project"
            onChange={(e) => set("workspacePath", e.target.value)}
          />
          <button type="button" className="btn ghost" title={t("agent.choose", lang)}>
            <Icon name="folder" size={14} />
          </button>
        </div>
      </Field>

      <Field
        label={t("agent.sandbox", lang)}
        hint={t("agent.sandboxHint", lang)}
        error={errorFor(issues, "agent.sandboxMode")}
      >
        <div className="sandbox-grid">
          {cards.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`sandbox-card${value.sandboxMode === m.id ? " active" : ""}`}
              onClick={() => onChange({ ...value, sandboxMode: m.id, sandboxEnabled: true })}
            >
              <div className="sc-head">
                <span className="sc-radio"><span /></span>
                <span className="sc-title">{m.title}</span>
                <span className="sc-tag">{m.tag}</span>
              </div>
              <div className="sc-body">{m.body}</div>
            </button>
          ))}
        </div>
      </Field>

      <div className="fld-stack toggle-stack">
        <ToggleRow
          id="agent-allow-shell"
          checked={value.allowShellExecution}
          onChange={(c) => set("allowShellExecution", c)}
          label={t("agent.allowShell", lang)}
          hint={t("agent.allowShellHint", lang)}
        />
        <ToggleRow
          id="agent-require-confirm"
          checked={value.requireConfirmationBeforeCommand}
          onChange={(c) => set("requireConfirmationBeforeCommand", c)}
          label={t("agent.requireConfirm", lang)}
          hint={t("agent.requireConfirmHint", lang)}
        />
      </div>

      <div className="fld-row">
        <Field
          label={t("agent.maxAutoSteps", lang)}
          hint={t("agent.maxAutoStepsHint", lang)}
          error={errorFor(issues, "agent.maxAutoSteps")}
          htmlFor="agent-maxsteps"
        >
          <NumInput
            id="agent-maxsteps"
            value={value.maxAutoSteps}
            min={1}
            step={1}
            onChange={(v) => set("maxAutoSteps", v)}
          />
        </Field>
        <Field
          label={t("agent.budgetCap", lang)}
          hint={t("agent.budgetCapHint", lang)}
          error={errorFor(issues, "agent.budgetUsd")}
          htmlFor="agent-budget"
        >
          <NumInput
            id="agent-budget"
            value={value.budgetUsd}
            min={0}
            max={5}
            step={0.25}
            suffix="USD"
            onChange={(v) => set("budgetUsd", v)}
          />
        </Field>
      </div>
    </div>
  );
}
