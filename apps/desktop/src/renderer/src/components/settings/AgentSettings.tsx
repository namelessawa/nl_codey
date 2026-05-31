import type {
  AgentSettings as AgentSettingsValue,
  InstallationStatus,
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
  /** Installation gate snapshot — disables every input when `degraded`. */
  installation: InstallationStatus;
  /** Click the "Install Docker" CTA in the locked-out warning banner. */
  onRequestInstall: () => void;
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

export function AgentSettings({
  value,
  onChange,
  issues,
  lang,
  installation,
  onRequestInstall,
}: Props): JSX.Element {
  // Hard-disable the entire panel while in degraded mode. The user must
  // either install Docker or explicitly clear the skip from the modal
  // before they can change agent settings — preventing accidental
  // re-enable of unsafe options.
  const locked = installation.degraded;
  const dockerMissing = !installation.docker.installed;
  const daemonStopped = installation.docker.installed && !installation.docker.daemonRunning;

  const set = <K extends keyof AgentSettingsValue>(key: K, v: AgentSettingsValue[K]): void => {
    if (locked) return;
    onChange({ ...value, [key]: v });
  };

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
    <div className={`pane${locked ? " pane-locked" : ""}`}>
      <header className="pane-head">
        <h3>{t("agent.paneTitle", lang)}</h3>
        <p>{t("agent.paneIntro", lang)}</p>
      </header>

      {(dockerMissing || daemonStopped) ? (
        <button
          type="button"
          className="docker-warning-banner"
          onClick={onRequestInstall}
        >
          <span className="dwb-icon">
            <span className="dwb-dot" />
          </span>
          <span className="dwb-body">
            <strong>
              {dockerMissing
                ? "Docker is not installed"
                : "Docker daemon is not running"}
            </strong>
            <span>
              {locked
                ? "Agent settings are locked while running in degraded mode. Click here to review the install guide."
                : "Install Docker Desktop to enable the strong sandbox. Click here for the install guide."}
            </span>
          </span>
          <span className="dwb-chevron">
            <Icon name="chev-right" size={13} stroke={2} />
          </span>
        </button>
      ) : null}

      <fieldset
        className="pane-fieldset"
        disabled={locked}
        aria-disabled={locked}
      >
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
                disabled={locked}
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
      </fieldset>
    </div>
  );
}
