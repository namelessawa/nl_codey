import { useEffect, useState } from "react";
import type { StyleRule, StyleSpec, StyleStrength } from "@nlc/shared";
import { api } from "../api";

export function StyleProfilePanel({ workspaceId }: { workspaceId: string | null }): JSX.Element {
  const [spec, setSpec] = useState<StyleSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    if (!workspaceId) {
      setSpec(null);
      return;
    }
    api.getStyleSpec("project", workspaceId).then(setSpec).catch((e) => setError(String(e)));
  };

  useEffect(load, [workspaceId]);

  const extract = async (): Promise<void> => {
    if (!workspaceId) return;
    try {
      const next = await api.extractStyleSpecFromCodebase(workspaceId);
      setSpec(next);
    } catch (e) {
      setError(String(e));
    }
  };

  const updateRule = async (rule: StyleRule, patch: Partial<StyleRule>): Promise<void> => {
    if (!spec) return;
    const nextRules = spec.rules.map((r) => (r.id === rule.id ? { ...r, ...patch, updatedAt: Date.now() } : r));
    const updated = await api.upsertStyleSpec({ ...spec, rules: nextRules });
    setSpec(updated);
  };

  const removeRule = async (id: string): Promise<void> => {
    if (!spec) return;
    const updated = await api.upsertStyleSpec({ ...spec, rules: spec.rules.filter((r) => r.id !== id) });
    setSpec(updated);
  };

  if (!workspaceId) return <p className="phase4-empty">请先打开一个工作区</p>;

  return (
    <div className="style-panel">
      <h2>编码风格画像</h2>
      {error && <div className="phase4-error">{error}</div>}
      <button type="button" onClick={() => void extract()}>从当前代码库抽取风格</button>
      {!spec && <p className="phase4-empty">尚未抽取风格,点击上方按钮开始。</p>}
      {spec && (
        <div>
          <p className="phase4-help">
            规则按强度排序(MUST &gt; SHOULD &gt; PREFER)。风格规范优先级低于代码正确性。
          </p>
          <ul className="style-rules">
            {spec.rules
              .slice()
              .sort((a, b) => strengthOrder(a.strength) - strengthOrder(b.strength))
              .map((r) => (
                <li key={r.id} className="style-rule">
                  <div className="style-rule-head">
                    <span className={`strength strength--${r.strength}`}>{r.strength.toUpperCase()}</span>
                    <span className="category">{r.category}</span>
                    <span className="conf">置信度 {r.confidence.toFixed(2)}</span>
                    <span className="src">来源: {r.source} ({r.signalCount} 次信号)</span>
                  </div>
                  <div className="style-rule-body">{r.rule}</div>
                  <div className="style-rule-actions">
                    <select
                      value={r.strength}
                      onChange={(e) =>
                        void updateRule(r, { strength: e.target.value as StyleStrength })
                      }
                    >
                      <option value="prefer">prefer</option>
                      <option value="should">should</option>
                      <option value="must">must</option>
                    </select>
                    <button type="button" onClick={() => void removeRule(r.id)}>删除</button>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function strengthOrder(s: StyleStrength): number {
  return s === "must" ? 0 : s === "should" ? 1 : 2;
}
