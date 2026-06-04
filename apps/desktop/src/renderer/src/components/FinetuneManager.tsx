import { useEffect, useState } from "react";
import type {
  EvalRunResult,
  FinetuneJob,
  FinetuneJobInput,
  FinetuneMethod,
  ModelRegistryEntry,
  PreferenceDataset,
} from "@coding-agent/shared";
import { api } from "../api";

const METHODS: FinetuneMethod[] = ["lora", "qlora"];

type Draft = FinetuneJobInput;

function emptyDraft(): Draft {
  return { name: "", baseModel: "", datasetId: "", method: "lora" };
}

export function FinetuneManager(): JSX.Element {
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [active, setActive] = useState<ModelRegistryEntry | null>(null);
  const [datasets, setDatasets] = useState<PreferenceDataset[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvalRunResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [evalModelFilter, setEvalModelFilter] = useState<string>("");
  const [evalTaskFilter, setEvalTaskFilter] = useState<string>("");

  const refresh = (): void => {
    api.listFinetuneJobs().then(setJobs).catch(() => {});
    api.listModels().then(setModels).catch(() => {});
    api.getActiveModel().then(setActive).catch(() => {});
    api.listPreferenceDatasets().then(setDatasets).catch(() => {});
  };
  useEffect(refresh, []);

  const refreshEvals = (): void => {
    api
      .listEvalRuns(
        evalTaskFilter.trim() || undefined,
        evalModelFilter.trim() || undefined,
      )
      .then(setEvalRuns)
      .catch((e) => setError(String(e)));
  };
  useEffect(refreshEvals, [evalTaskFilter, evalModelFilter]);

  const rollback = async (): Promise<void> => {
    if (!confirm("确认一键回退到基座模型?")) return;
    try {
      const base = await api.rollbackToBaseModel();
      setActive(base);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const promote = async (id: string): Promise<void> => {
    try {
      const promoted = await api.promoteModel(id);
      setActive(promoted);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const submitJob = async (): Promise<void> => {
    setError(null);
    if (!draft.name.trim()) { setError("name 必填"); return; }
    if (!draft.baseModel.trim()) { setError("baseModel 必填"); return; }
    if (!draft.datasetId.trim()) { setError("datasetId 必填"); return; }
    setSubmitting(true);
    try {
      await api.createFinetuneJob({
        name: draft.name.trim(),
        baseModel: draft.baseModel.trim(),
        datasetId: draft.datasetId.trim(),
        method: draft.method,
      });
      setDraft(emptyDraft());
      setShowForm(false);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="finetune-manager">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>微调管理</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "取消创建" : "+ 创建微调任务"}
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
          <h3 style={{ marginTop: 0 }}>新建微调任务</h3>
          <div className="phase4-field">
            <label htmlFor="ft-name">name *</label>
            <input
              id="ft-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="ft-base">baseModel *</label>
            <input
              id="ft-base"
              placeholder="deepseek-chat / claude-3-5-sonnet…"
              value={draft.baseModel}
              onChange={(e) => setDraft({ ...draft, baseModel: e.target.value })}
              list="ft-base-suggest"
            />
            <datalist id="ft-base-suggest">
              {models.map((m) => (
                <option key={m.id} value={m.baseModel} />
              ))}
            </datalist>
          </div>
          <div className="phase4-field">
            <label htmlFor="ft-dataset">datasetId *</label>
            <select
              id="ft-dataset"
              value={draft.datasetId}
              onChange={(e) => setDraft({ ...draft, datasetId: e.target.value })}
            >
              <option value="">— 选择 —</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.pairs.length} 对
                </option>
              ))}
            </select>
          </div>
          <div className="phase4-field">
            <label htmlFor="ft-method">method</label>
            <select
              id="ft-method"
              value={draft.method}
              onChange={(e) => setDraft({ ...draft, method: e.target.value as FinetuneMethod })}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void submitJob()} disabled={submitting}>
              {submitting ? "提交中…" : "提交任务"}
            </button>
            <button type="button" onClick={() => setDraft(emptyDraft())}>重置</button>
          </div>
        </section>
      )}

      <section>
        <h3>当前激活模型</h3>
        <p>{active ? `${active.name} (${active.kind})` : "未激活任何模型"}</p>
        <button type="button" onClick={() => void rollback()}>一键回退到基座</button>
        <p className="phase4-help">回退立即生效;所有后续任务将使用基座模型。</p>
      </section>

      <section>
        <h3>模型注册表</h3>
        {models.length === 0 && <p className="phase4-empty">无注册模型</p>}
        <ul>
          {models.map((m) => (
            <li key={m.id} className={m.active ? "model active" : "model"}>
              <strong>{m.name}</strong> ({m.kind})
              {m.evalDelta !== null && <span> Δ={(m.evalDelta * 100).toFixed(1)}pp</span>}
              {!m.active && (
                <button type="button" onClick={() => void promote(m.id)}>促晋为激活</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>微调任务</h3>
        {jobs.length === 0 && <p className="phase4-empty">无任务记录</p>}
        <table className="job-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>基座</th>
              <th>方法</th>
              <th>状态</th>
              <th>Eval Δ</th>
              <th>遗忘检测</th>
              <th>退化任务</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.name}</td>
                <td>{j.baseModel}</td>
                <td>{j.method}</td>
                <td>{j.status}</td>
                <td>{j.evalResult ? (j.evalResult.delta * 100).toFixed(1) + "pp" : "—"}</td>
                <td>
                  {j.evalResult
                    ? `${j.evalResult.holdoutScore.toFixed(2)} vs ${j.evalResult.holdoutBaselineScore.toFixed(2)}`
                    : "—"}
                </td>
                <td>{j.evalResult ? j.evalResult.perTaskRegressions.length : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Eval Runs</h3>
        <div className="phase4-field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="筛选 taskId(可留空)"
            value={evalTaskFilter}
            onChange={(e) => setEvalTaskFilter(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            placeholder="筛选 modelId(可留空)"
            value={evalModelFilter}
            onChange={(e) => setEvalModelFilter(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={refreshEvals}>刷新</button>
        </div>
        {evalRuns.length === 0 && <p className="phase4-empty">无 eval 记录</p>}
        {evalRuns.length > 0 && (
          <table className="job-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>模型</th>
                <th>通过</th>
                <th>修正</th>
                <th>复用命中</th>
                <th>耗时(ms)</th>
                <th>成本(USD)</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {evalRuns.map((r) => (
                <tr key={r.id}>
                  <td>{r.taskId}</td>
                  <td>{r.modelId}</td>
                  <td>{r.pass ? "✓" : "✗"}</td>
                  <td>{r.corrections}</td>
                  <td>{r.transferHits}</td>
                  <td>{r.durationMs}</td>
                  <td>{r.costUsd.toFixed(4)}</td>
                  <td title={r.errorMessage ?? ""}>
                    {r.errorMessage ? r.errorMessage.slice(0, 40) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
