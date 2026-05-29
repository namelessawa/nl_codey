import { useEffect, useState } from "react";
import type { FinetuneJob, ModelRegistryEntry } from "@coding-agent/shared";
import { api } from "../api";

export function FinetuneManager(): JSX.Element {
  const [jobs, setJobs] = useState<FinetuneJob[]>([]);
  const [models, setModels] = useState<ModelRegistryEntry[]>([]);
  const [active, setActive] = useState<ModelRegistryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    api.listFinetuneJobs().then(setJobs).catch(() => {});
    api.listModels().then(setModels).catch(() => {});
    api.getActiveModel().then(setActive).catch(() => {});
  };
  useEffect(refresh, []);

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

  return (
    <div className="finetune-manager">
      <h2>微调管理</h2>
      {error && <div className="phase4-error">{error}</div>}

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
    </div>
  );
}
