/**
 * Advanced-features surface — a single panel that mounts knowledge graph,
 * style profile, learning, finetune, proposals, cluster, and plugins as
 * tabs. Keeps the chat-centric shell untouched; opened from the Topbar
 * alongside the Intelligence panel.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AdvancedSettings, WorkspaceContributionMode } from "@nlc/shared";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { StyleProfilePanel } from "./StyleProfilePanel";
import { LearningDashboard } from "./LearningDashboard";
import { FinetuneManager } from "./FinetuneManager";
import { ProposalInbox } from "./ProposalInbox";
import { ClusterMonitor } from "./ClusterMonitor";
import { PluginManager } from "./PluginManager";

type TabId = "kg" | "style" | "learning" | "finetune" | "proposals" | "cluster" | "plugins" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "kg", label: "知识图谱" },
  { id: "style", label: "风格画像" },
  { id: "learning", label: "学习曲线" },
  { id: "finetune", label: "微调管理" },
  { id: "proposals", label: "提案收件箱" },
  { id: "cluster", label: "分布式节点" },
  { id: "plugins", label: "插件管理" },
  { id: "settings", label: "功能开关" },
];

export function AdvancedPanel({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [tab, setTab] = useState<TabId>("kg");
  const [settings, setSettings] = useState<AdvancedSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    // M9: a silent .catch left the settings view stuck on "Loading…" forever
    // when the IPC failed. Track the error explicitly so the user sees what
    // went wrong instead of an indefinite spinner.
    api
      .getAdvancedSettings()
      .then((next) => {
        setSettings(next);
        setSettingsError(null);
      })
      .catch((e) => setSettingsError(String(e)));
  }, []);

  return (
    <div className="advanced-panel">
      <div className="advanced-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`advanced-tab ${tab === t.id ? "advanced-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="advanced-tabbody">
        {tab === "kg" && <KnowledgeGraphView workspaceId={workspaceId} />}
        {tab === "style" && <StyleProfilePanel workspaceId={workspaceId} />}
        {tab === "learning" && <LearningDashboard workspaceId={workspaceId} />}
        {tab === "finetune" && <FinetuneManager />}
        {tab === "proposals" && <ProposalInbox workspaceId={workspaceId} />}
        {tab === "cluster" && <ClusterMonitor />}
        {tab === "plugins" && <PluginManager />}
        {tab === "settings" && (
          <AdvancedSettingsView
            settings={settings}
            error={settingsError}
            onChange={(next) => {
              setSettings(next);
              // Surface update failures too — silently swallowing left the
              // UI showing the new values while the backend still had the
              // old ones.
              api
                .updateAdvancedSettings(next)
                .then(() => setSettingsError(null))
                .catch((e) => setSettingsError(String(e)));
            }}
          />
        )}
      </div>
    </div>
  );
}

function AdvancedSettingsView({
  settings,
  error,
  onChange,
}: {
  settings: AdvancedSettings | null;
  error: string | null;
  onChange: (next: AdvancedSettings) => void;
}): JSX.Element {
  if (error && !settings) {
    return (
      <div className="advanced-settings">
        <div className="advanced-error">无法加载高级设置:{error}</div>
      </div>
    );
  }
  if (!settings) return <div>Loading…</div>;
  const toggle = (key: keyof AdvancedSettings) => () => {
    const cur = settings[key];
    if (typeof cur === "boolean") onChange({ ...settings, [key]: !cur });
  };
  const setContribution = (mode: WorkspaceContributionMode): void => {
    onChange({ ...settings, contributionMode: mode });
  };
  const setInterval = (raw: string): void => {
    const next = Number(raw);
    if (!Number.isFinite(next) || next < 1) return;
    onChange({ ...settings, proactiveScanIntervalMin: Math.round(next) });
  };
  return (
    <div className="advanced-settings">
      <h2>高级功能开关</h2>
      {error && <div className="advanced-error">设置同步失败:{error}</div>}
      <p className="advanced-help">每个模块独立可关。关闭后系统退回完整可用的第三阶段形态。</p>
      <ul>
        <Toggle label="跨项目记忆与知识图谱" on={settings.globalMemoryEnabled} onToggle={toggle("globalMemoryEnabled")} />
        <Toggle label="编码风格画像" on={settings.styleProfileEnabled} onToggle={toggle("styleProfileEnabled")} />
        <Toggle label="持续学习闭环" on={settings.learningEnabled} onToggle={toggle("learningEnabled")} />
        <Toggle label="本地模型微调(高级)" on={settings.finetuneEnabled} onToggle={toggle("finetuneEnabled")} />
        <Toggle label="分布式执行" on={settings.distributedEnabled} onToggle={toggle("distributedEnabled")} />
        <Toggle label="主动工程伙伴" on={settings.proactiveEnabled} onToggle={toggle("proactiveEnabled")} />
        <Toggle label="插件机制" on={settings.pluginsEnabled} onToggle={toggle("pluginsEnabled")} />
      </ul>

      <h3 className="advanced-subhead">本工作区贡献模式</h3>
      <p className="advanced-help">
        控制本工作区学到的模式是否汇入全局知识池。仅在跨项目记忆开启时生效。
      </p>
      <div className="advanced-field">
        <label htmlFor="advanced-contribution-mode">贡献模式</label>
        <select
          id="advanced-contribution-mode"
          value={settings.contributionMode}
          onChange={(e) => setContribution(e.target.value as WorkspaceContributionMode)}
        >
          <option value="isolated">隔离 · 不读不写全局池</option>
          <option value="contribute">贡献 · 读写全局池</option>
          <option value="team_shared">团队共享 · 仅同团队可见</option>
        </select>
      </div>

      <h3 className="advanced-subhead">主动工程伙伴</h3>
      <p className="advanced-help">后台扫描技术债 / 待办的频率。仅在主动模式开启时生效。</p>
      <div className="advanced-field">
        <label htmlFor="advanced-proactive-interval">扫描间隔(分钟)</label>
        <input
          id="advanced-proactive-interval"
          type="number"
          min={1}
          max={1440}
          step={1}
          value={settings.proactiveScanIntervalMin}
          onChange={(e) => setInterval(e.target.value)}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <li className="advanced-toggle">
      <label>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span>{label}</span>
      </label>
    </li>
  );
}
