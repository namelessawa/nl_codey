import { useEffect, useState } from "react";
import type {
  ChunkKind,
  SemanticHit,
  SemanticIndexStatus,
} from "@nlc/shared";
import { api } from "../api.js";

const ALL_KINDS: ChunkKind[] = ["code", "doc", "comment"];

interface SemanticSearchViewProps {
  workspaceId: string;
}

/**
 * Phase 3 semantic-index workbench: shows index status, lets the user trigger
 * a rebuild, and runs vector queries with kind/topK options.
 */
export function SemanticSearchView({ workspaceId }: SemanticSearchViewProps): JSX.Element {
  const [status, setStatus] = useState<SemanticIndexStatus | null>(null);
  const [query, setQuery] = useState<string>("");
  const [topK, setTopK] = useState<number>(10);
  const [kinds, setKinds] = useState<ChunkKind[]>(["code", "doc", "comment"]);
  const [hits, setHits] = useState<SemanticHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState<boolean>(false);
  const [rebuilding, setRebuilding] = useState<boolean>(false);

  const refreshStatus = (): void => {
    api.getSemanticIndexStatus(workspaceId).then(setStatus).catch((e) => setError(String(e)));
  };

  useEffect(() => {
    refreshStatus();
    // Live updates: the rebuild handler emits index_status at start and
    // end of every build, so the panel flips immediately without
    // waiting for a poll tick.
    const unsub = api.onAgentEvent((event) => {
      if (event.kind === "index_status" && event.workspaceId === workspaceId) {
        setStatus(event.status);
      }
    });
    // Belt-and-braces poll while a build is running, in case an emit was
    // lost or the handler crashed without the finally clause firing.
    const id = setInterval(() => {
      if (status?.building) refreshStatus();
    }, 2000);
    return () => {
      clearInterval(id);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, status?.building]);

  const rebuild = async (): Promise<void> => {
    setError(null);
    setRebuilding(true);
    try {
      const next = await api.rebuildSemanticIndex(workspaceId);
      setStatus(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setRebuilding(false);
    }
  };

  const toggleKind = (k: ChunkKind): void => {
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  };

  const search = async (): Promise<void> => {
    setError(null);
    if (!query.trim()) {
      setError("查询不能为空");
      return;
    }
    setSearching(true);
    try {
      const next = await api.semanticSearch(workspaceId, query.trim(), {
        topK,
        kinds: kinds.length === ALL_KINDS.length ? undefined : kinds,
      });
      setHits(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSearching(false);
    }
  };

  const lastUpdated = status?.lastUpdated
    ? new Date(status.lastUpdated).toLocaleString()
    : "—";

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0 }}>语义搜索</h3>
      {error && <div className="phase4-error">{error}</div>}

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 10,
          background: "var(--surface-2)",
          fontFamily: "var(--mono)",
          fontSize: 12,
        }}
      >
        <div>
          <strong>索引状态</strong>: {status ? `${status.indexedFiles}/${status.totalFiles} 文件 · 最近更新 ${lastUpdated} · ${status.building ? "正在构建" : "空闲"}` : "—"}
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => void rebuild()} disabled={rebuilding}>
            {rebuilding ? "重建中…" : "重建索引"}
          </button>
          <button type="button" onClick={refreshStatus} style={{ marginLeft: 8 }}>
            刷新状态
          </button>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 10,
        }}
      >
        <div className="phase4-field">
          <label htmlFor="ss-q">查询</label>
          <textarea
            id="ss-q"
            rows={2}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="自然语言查询,例如:存储 settings.json 的代码"
          />
        </div>
        <div className="phase4-field" style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <label htmlFor="ss-topk">topK</label>
          <input
            id="ss-topk"
            type="number"
            min={1}
            max={50}
            value={topK}
            onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value))))}
            style={{ width: 80 }}
          />
          <span>kinds</span>
          {ALL_KINDS.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />{" "}
              {k}
            </label>
          ))}
          <button type="button" onClick={() => void search()} disabled={searching}>
            {searching ? "搜索中…" : "搜索"}
          </button>
        </div>
      </section>

      <section>
        <h4 style={{ marginBottom: 8 }}>结果 ({hits.length})</h4>
        {hits.length === 0 && <p className="phase4-empty">暂无结果</p>}
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {hits.map((h, i) => (
            <li
              key={`${h.filePath}:${h.startLine}:${i}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 10,
                background: "var(--surface)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                }}
              >
                <span>{h.filePath}:{h.startLine}-{h.endLine}</span>
                <span>· {h.kind}</span>
                {h.symbolName && <span>· {h.symbolName}</span>}
                <span style={{ marginLeft: "auto" }}>score {h.score.toFixed(3)}</span>
              </div>
              <pre
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  whiteSpace: "pre-wrap",
                  maxHeight: 180,
                  overflow: "auto",
                }}
              >
                {h.snippet}
              </pre>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
