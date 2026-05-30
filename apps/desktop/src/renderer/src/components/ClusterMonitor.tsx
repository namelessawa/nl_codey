import { useEffect, useState } from "react";
import type { WorkerNode } from "@coding-agent/shared";
import { api } from "../api";

export function ClusterMonitor(): JSX.Element {
  const [nodes, setNodes] = useState<WorkerNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    api.listWorkerNodes().then(setNodes).catch((e) => setError(String(e)));
  };
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="cluster-monitor">
      <h2>分布式节点监控</h2>
      {error && <div className="phase4-error">{error}</div>}
      <p className="phase4-help">
        所有节点必须在同一可信边界内。跨组织节点共享在 Phase 4 未启用。
      </p>
      {nodes.length === 0 && <p className="phase4-empty">尚无已注册节点(仅运行在本机)</p>}
      <table className="node-table">
        <thead>
          <tr>
            <th>节点</th>
            <th>主机名</th>
            <th>状态</th>
            <th>能力</th>
            <th>活跃任务</th>
            <th>最近心跳</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} className={`node node--${n.status}`}>
              <td>{n.id}</td>
              <td>{n.hostname}</td>
              <td>{n.status}</td>
              <td>{n.capabilities.join(", ")}</td>
              <td>{n.activeAssignments.length}</td>
              <td>{new Date(n.lastHeartbeat).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
