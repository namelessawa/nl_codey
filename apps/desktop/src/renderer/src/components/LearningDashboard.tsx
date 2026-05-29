import { useEffect, useMemo, useState } from "react";
import type { FeedbackSignal, FrozenSuiteSnapshot } from "@coding-agent/shared";
import { api } from "../api";

export function LearningDashboard({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [signals, setSignals] = useState<FeedbackSignal[]>([]);
  const [snapshots, setSnapshots] = useState<FrozenSuiteSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId) {
      api.listFeedbackSignals(workspaceId).then(setSignals).catch((e) => setError(String(e)));
    }
    api.listFrozenSnapshots().then(setSnapshots).catch(() => {});
  }, [workspaceId]);

  const counts = useMemo(() => {
    const c = { diff_accepted: 0, diff_rejected: 0, diff_edited: 0, review_overturned: 0, manual_correction: 0 };
    for (const s of signals) c[s.kind]++;
    return c;
  }, [signals]);

  const buildDataset = async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const result = await api.buildPreferenceDataset(workspaceId);
      alert(`已构建偏好数据集 ${result.datasetId}:保留 ${result.built} 条,过滤 ${result.rejected} 条`);
    } catch (e) {
      setError(String(e));
    }
  };

  const trend = useMemo(
    () => snapshots.slice().sort((a, b) => a.weekStartTs - b.weekStartTs),
    [snapshots],
  );

  return (
    <div className="learning-dashboard">
      <h2>学习曲线</h2>
      {error && <div className="phase4-error">{error}</div>}

      <section>
        <h3>反馈信号</h3>
        <ul className="signal-counts">
          <li>接受 {counts.diff_accepted}</li>
          <li>拒绝 {counts.diff_rejected}</li>
          <li>编辑 {counts.diff_edited}</li>
          <li>评审翻案 {counts.review_overturned}</li>
          <li>人工修正 {counts.manual_correction}</li>
        </ul>
        <button type="button" onClick={() => void buildDataset()}>构建偏好数据集</button>
      </section>

      <section>
        <h3>冻结回归套件得分(每周)</h3>
        {trend.length === 0 && <p className="phase4-empty">尚无快照</p>}
        <table className="trend-table">
          <thead>
            <tr>
              <th>周</th>
              <th>模型</th>
              <th>Pass Rate</th>
              <th>每任务修正</th>
              <th>跨项目复用</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((s) => (
              <tr key={`${s.weekStartTs}-${s.modelId}`}>
                <td>{new Date(s.weekStartTs).toISOString().slice(0, 10)}</td>
                <td>{s.modelId}</td>
                <td>{(s.passRate * 100).toFixed(1)}%</td>
                <td>{s.correctionsPerTask.toFixed(2)}</td>
                <td>{s.transferHits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
