import { useEffect, useState } from "react";
import type { Proposal } from "@coding-agent/shared";
import { api } from "../api";

export function ProposalInbox({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    if (!workspaceId) {
      setProposals([]);
      return;
    }
    api.listProposals(workspaceId).then(setProposals).catch((e) => setError(String(e)));
  };

  useEffect(refresh, [workspaceId]);

  const scan = async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const result = await api.scanDebtNow(workspaceId);
      alert(`扫描完成,新增 ${result.created.length} 条提案`);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const action = async (id: string, kind: "dismiss" | "snooze" | "convert"): Promise<void> => {
    try {
      if (kind === "dismiss") await api.dismissProposal(id);
      else if (kind === "snooze") await api.snoozeProposal(id, Date.now() + 7 * 86400_000);
      else await api.convertProposal(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!workspaceId) return <p className="phase4-empty">请先打开一个工作区</p>;

  return (
    <div className="proposal-inbox">
      <h2>主动提案收件箱</h2>
      <p className="phase4-help">
        Agent 只产生提案,绝不直接修改文件。你可以延后、忽略或将其转换为正式任务。
      </p>
      {error && <div className="phase4-error">{error}</div>}
      <button type="button" onClick={() => void scan()}>立即扫描技术债</button>

      {proposals.length === 0 && <p className="phase4-empty">收件箱为空</p>}
      <ul className="proposal-list">
        {proposals.map((p) => (
          <li key={p.id} className={`proposal proposal--${p.status}`}>
            <div className="proposal-head">
              <span className={`kind kind--${p.kind}`}>{p.kind}</span>
              <strong>{p.title}</strong>
              <span className="effort">工作量 {p.estimatedEffort}</span>
              <span className="status">[{p.status}]</span>
            </div>
            <p className="rationale">{p.rationale}</p>
            <p className="files">影响文件: {p.affectedFiles.join(", ") || "—"}</p>
            {p.status === "new" && (
              <div className="proposal-actions">
                <button
                  type="button"
                  disabled
                  title="即将推出 · 转换为正式任务还未接入 Planner pipeline"
                  onClick={() => void action(p.id, "convert")}
                >
                  转为任务 (即将推出)
                </button>
                <button type="button" onClick={() => void action(p.id, "snooze")}>延后 7 天</button>
                <button type="button" onClick={() => void action(p.id, "dismiss")}>忽略</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
