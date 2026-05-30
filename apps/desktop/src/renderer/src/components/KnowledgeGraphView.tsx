import { useEffect, useState } from "react";
import type {
  GlobalPattern,
  WorkspaceContributionMode,
} from "@coding-agent/shared";
import { api } from "../api";

export function KnowledgeGraphView({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [patterns, setPatterns] = useState<GlobalPattern[]>([]);
  const [mode, setMode] = useState<WorkspaceContributionMode>("isolated");
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    api.listGlobalPatterns().then(setPatterns).catch((e) => setError(String(e)));
    if (workspaceId) {
      api.getWorkspaceContribution(workspaceId).then(setMode).catch(() => {});
    }
  };

  useEffect(refresh, [workspaceId]);

  const changeMode = async (next: WorkspaceContributionMode): Promise<void> => {
    if (!workspaceId) return;
    try {
      const updated = await api.setWorkspaceContribution(workspaceId, next);
      setMode(updated);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const delPattern = async (id: string): Promise<void> => {
    if (!confirm("确认删除此模式?")) return;
    await api.deleteGlobalPattern(id);
    refresh();
  };

  return (
    <div className="kg-view">
      <h2>跨项目知识图谱</h2>
      {error && <div className="phase4-error">{error}</div>}
      <div className="kg-controls">
        <span>当前项目贡献模式:</span>
        <select
          value={mode}
          onChange={(e) => void changeMode(e.target.value as WorkspaceContributionMode)}
          disabled={!workspaceId}
        >
          <option value="isolated">隔离(不贡献)</option>
          <option value="contribute">贡献到全局</option>
          <option value="team_shared">团队共享</option>
        </select>
        <p className="phase4-help">
          默认隔离。开启贡献后,本项目的已验证模式将参与跨项目知识图谱抽取。任何时刻可撤回本项目对全局的贡献。
        </p>
      </div>

      <div className="kg-patterns">
        <h3>全局模式({patterns.length})</h3>
        {patterns.length === 0 && <p className="phase4-empty">尚无模式,等待抽取器促晋。</p>}
        {patterns.map((p) => (
          <div key={p.id} className="kg-pattern-card">
            <div className="kg-pattern-head">
              <strong>{p.title}</strong>
              <span className="kg-conf">置信度 {p.confidence.toFixed(2)}</span>
            </div>
            <p className="kg-desc">{p.description}</p>
            <div className="kg-prov">
              来自项目: {p.sourceProjects.join(", ")}
            </div>
            <button type="button" onClick={() => void delPattern(p.id)}>删除该模式</button>
          </div>
        ))}
      </div>
    </div>
  );
}
