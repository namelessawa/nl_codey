import { useEffect, useState } from "react";
import type { NodeStatus, WorkerNode } from "@coding-agent/shared";
import { api } from "../api";

const STATUSES: NodeStatus[] = ["online", "busy", "offline", "degraded"];

type Draft = {
  id: string;
  hostname: string;
  endpoint: string;
  status: NodeStatus;
  capabilities: string;
  activeAssignments: string;
};

function emptyDraft(): Draft {
  return {
    id: "",
    hostname: "",
    endpoint: "",
    status: "online",
    capabilities: "",
    activeAssignments: "",
  };
}

export function ClusterMonitor(): JSX.Element {
  const [nodes, setNodes] = useState<WorkerNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const refresh = (): void => {
    api.listWorkerNodes().then(setNodes).catch((e) => setError(String(e)));
  };
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, []);

  const submit = async (): Promise<void> => {
    setError(null);
    if (!draft.id.trim()) {
      setError("节点 id 必填");
      return;
    }
    if (!draft.hostname.trim()) {
      setError("hostname 必填");
      return;
    }
    if (!draft.endpoint.trim()) {
      setError("endpoint 必填");
      return;
    }
    const node: Omit<WorkerNode, "registeredAt"> = {
      id: draft.id.trim(),
      hostname: draft.hostname.trim(),
      endpoint: draft.endpoint.trim(),
      status: draft.status,
      capabilities: draft.capabilities
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      activeAssignments: draft.activeAssignments
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      lastHeartbeat: Date.now(),
    };
    setSubmitting(true);
    try {
      await api.registerWorkerNode(node);
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
    <div className="cluster-monitor">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>分布式节点监控</h2>
        <button type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "取消注册" : "+ 注册节点"}
        </button>
      </div>
      {error && <div className="phase4-error">{error}</div>}
      <p className="phase4-help">
        所有节点必须在同一可信边界内。跨组织节点共享在 Phase 4 未启用。
      </p>

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
          <h3 style={{ marginTop: 0 }}>注册新节点</h3>
          <div className="phase4-field">
            <label htmlFor="cm-id">id *</label>
            <input
              id="cm-id"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="cm-host">hostname *</label>
            <input
              id="cm-host"
              value={draft.hostname}
              onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="cm-endpoint">endpoint *</label>
            <input
              id="cm-endpoint"
              placeholder="http://10.0.0.5:8787"
              value={draft.endpoint}
              onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="cm-status">status</label>
            <select
              id="cm-status"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as NodeStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="phase4-field">
            <label htmlFor="cm-cap">capabilities (逗号分隔)</label>
            <input
              id="cm-cap"
              placeholder="docker, gpu, lora"
              value={draft.capabilities}
              onChange={(e) => setDraft({ ...draft, capabilities: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="cm-assign">activeAssignments (逗号分隔, task node id)</label>
            <input
              id="cm-assign"
              value={draft.activeAssignments}
              onChange={(e) => setDraft({ ...draft, activeAssignments: e.target.value })}
            />
          </div>
          <p className="phase4-help">
            lastHeartbeat 在提交时自动取当前时间; registeredAt 由后端写入。
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "注册中…" : "注册"}
            </button>
            <button type="button" onClick={() => setDraft(emptyDraft())}>重置</button>
          </div>
        </section>
      )}

      {nodes.length === 0 && <p className="phase4-empty">尚无已注册节点(仅运行在本机)</p>}
      <table className="node-table">
        <thead>
          <tr>
            <th>节点</th>
            <th>主机名</th>
            <th>端点</th>
            <th>状态</th>
            <th>能力</th>
            <th>活跃任务</th>
            <th>最近心跳</th>
            <th>注册时间</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} className={`node node--${n.status}`}>
              <td>{n.id}</td>
              <td>{n.hostname}</td>
              <td>{n.endpoint}</td>
              <td>{n.status}</td>
              <td>{n.capabilities.join(", ")}</td>
              <td>{n.activeAssignments.length}</td>
              <td>{new Date(n.lastHeartbeat).toLocaleTimeString()}</td>
              <td>{new Date(n.registeredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
