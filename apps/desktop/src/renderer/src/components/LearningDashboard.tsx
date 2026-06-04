import { useEffect, useMemo, useState } from "react";
import type {
  FeedbackSignal,
  FeedbackSignalInput,
  FeedbackSignalKind,
  FrozenSuiteSnapshot,
} from "@coding-agent/shared";
import { api } from "../api";

const KINDS: FeedbackSignalKind[] = [
  "diff_accepted",
  "diff_rejected",
  "diff_edited",
  "review_overturned",
  "manual_correction",
];

type Draft = {
  runId: string;
  taskNodeId: string;
  kind: FeedbackSignalKind;
  before: string;
  after: string;
  reason: string;
  filePath: string;
};

function emptyDraft(): Draft {
  return {
    runId: "",
    taskNodeId: "",
    kind: "manual_correction",
    before: "",
    after: "",
    reason: "",
    filePath: "",
  };
}

export function LearningDashboard({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [signals, setSignals] = useState<FeedbackSignal[]>([]);
  const [snapshots, setSnapshots] = useState<FrozenSuiteSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const refreshSignals = (): void => {
    if (workspaceId) {
      api
        .listFeedbackSignals(workspaceId)
        .then(setSignals)
        .catch((e) => setError(String(e)));
    } else {
      setSignals([]);
    }
  };

  useEffect(() => {
    refreshSignals();
    api.listFrozenSnapshots().then(setSnapshots).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  const counts = useMemo(() => {
    const c: Record<FeedbackSignalKind, number> = {
      diff_accepted: 0,
      diff_rejected: 0,
      diff_edited: 0,
      review_overturned: 0,
      manual_correction: 0,
    };
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

  const submit = async (): Promise<void> => {
    setError(null);
    if (!workspaceId) {
      setError("先打开一个工作区");
      return;
    }
    if (!draft.runId.trim()) {
      setError("runId 必填(用于把信号挂回具体 run)");
      return;
    }
    if (!draft.before.trim()) {
      setError("before(agent 版本)必填");
      return;
    }
    const signal: FeedbackSignalInput = {
      workspaceId,
      runId: draft.runId.trim(),
      taskNodeId: draft.taskNodeId.trim() || null,
      kind: draft.kind,
      before: draft.before,
      after: draft.after.trim() ? draft.after : null,
      reason: draft.reason.trim() ? draft.reason.trim() : null,
      filePath: draft.filePath.trim() ? draft.filePath.trim() : null,
    };
    setSubmitting(true);
    try {
      await api.recordFeedbackSignal(signal);
      setDraft(emptyDraft());
      setShowForm(false);
      refreshSignals();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const trend = useMemo(
    () => snapshots.slice().sort((a, b) => a.weekStartTs - b.weekStartTs),
    [snapshots],
  );

  return (
    <div className="learning-dashboard">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>学习曲线</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "取消记录" : "+ 记录反馈信号"}
        </button>
      </div>
      {error && <div className="phase4-error">{error}</div>}

      {showForm && (
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            background: "var(--surface-2)",
          }}
        >
          <h3 style={{ marginTop: 0 }}>记录反馈信号</h3>
          <p className="phase4-help">
            常规流程下,接受/拒绝/编辑会由 GUI 自动记录;此入口用于补录历史信号或手工注入。
          </p>
          <div className="phase4-field">
            <label htmlFor="fb-run">runId *</label>
            <input
              id="fb-run"
              value={draft.runId}
              onChange={(e) => setDraft({ ...draft, runId: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-task">taskNodeId (可空)</label>
            <input
              id="fb-task"
              value={draft.taskNodeId}
              onChange={(e) => setDraft({ ...draft, taskNodeId: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-kind">kind</label>
            <select
              id="fb-kind"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as FeedbackSignalKind })}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-file">filePath (可空)</label>
            <input
              id="fb-file"
              value={draft.filePath}
              onChange={(e) => setDraft({ ...draft, filePath: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-before">before (agent 版本) *</label>
            <textarea
              id="fb-before"
              rows={4}
              value={draft.before}
              onChange={(e) => setDraft({ ...draft, before: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-after">after (人工版本,可空)</label>
            <textarea
              id="fb-after"
              rows={4}
              value={draft.after}
              onChange={(e) => setDraft({ ...draft, after: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="fb-reason">reason (可空)</label>
            <input
              id="fb-reason"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "记录中…" : "记录"}
            </button>
            <button type="button" onClick={() => setDraft(emptyDraft())}>重置</button>
          </div>
        </section>
      )}

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
