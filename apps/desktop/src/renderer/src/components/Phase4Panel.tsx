/**
 * Phase 4 surface — a single panel that mounts all Phase 4 views as tabs.
 * Keeps the Phase 3 chat-centric shell untouched; users open this from the
 * Topbar like the existing Phase 3 panel.
 */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Phase4Settings } from "@coding-agent/shared";
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

export function Phase4Panel({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [tab, setTab] = useState<TabId>("kg");
  const [settings, setSettings] = useState<Phase4Settings | null>(null);

  useEffect(() => {
    api.getPhase4Settings().then(setSettings).catch(() => {});
  }, []);

  return (
    <div className="phase4-panel">
      <div className="phase4-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`phase4-tab ${tab === t.id ? "phase4-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="phase4-tabbody">
        {tab === "kg" && <KnowledgeGraphView workspaceId={workspaceId} />}
        {tab === "style" && <StyleProfilePanel workspaceId={workspaceId} />}
        {tab === "learning" && <LearningDashboard workspaceId={workspaceId} />}
        {tab === "finetune" && <FinetuneManager />}
        {tab === "proposals" && <ProposalInbox workspaceId={workspaceId} />}
        {tab === "cluster" && <ClusterMonitor />}
        {tab === "plugins" && <PluginManager />}
        {tab === "settings" && (
          <Phase4SettingsView
            settings={settings}
            onChange={(next) => {
              setSettings(next);
              api.updatePhase4Settings(next).catch(() => {});
            }}
          />
        )}
      </div>
    </div>
  );
}

function Phase4SettingsView({
  settings,
  onChange,
}: {
  settings: Phase4Settings | null;
  onChange: (next: Phase4Settings) => void;
}): JSX.Element {
  if (!settings) return <div>Loading…</div>;
  const toggle = (key: keyof Phase4Settings) => () => {
    const cur = settings[key];
    if (typeof cur === "boolean") onChange({ ...settings, [key]: !cur });
  };
  return (
    <div className="phase4-settings">
      <h2>Phase 4 功能开关</h2>
      <p className="phase4-help">每个模块独立可关。关闭后系统退回完整可用的第三阶段形态。</p>
      <ul>
        <Toggle label="跨项目记忆与知识图谱" on={settings.globalMemoryEnabled} onToggle={toggle("globalMemoryEnabled")} />
        <Toggle label="编码风格画像" on={settings.styleProfileEnabled} onToggle={toggle("styleProfileEnabled")} />
        <Toggle label="持续学习闭环" on={settings.learningEnabled} onToggle={toggle("learningEnabled")} />
        <Toggle label="本地模型微调(高级)" on={settings.finetuneEnabled} onToggle={toggle("finetuneEnabled")} />
        <Toggle label="分布式执行" on={settings.distributedEnabled} onToggle={toggle("distributedEnabled")} />
        <Toggle label="主动工程伙伴" on={settings.proactiveEnabled} onToggle={toggle("proactiveEnabled")} />
        <Toggle label="插件机制" on={settings.pluginsEnabled} onToggle={toggle("pluginsEnabled")} />
      </ul>
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
    <li className="phase4-toggle">
      <label>
        <input type="checkbox" checked={on} onChange={onToggle} />
        <span>{label}</span>
      </label>
    </li>
  );
}
