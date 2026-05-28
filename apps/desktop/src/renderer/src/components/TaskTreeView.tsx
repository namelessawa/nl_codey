import { useCallback, useEffect, useMemo, useState } from "react";
import type { TaskNode, TaskNodeStatus } from "@coding-agent/shared";
import { api } from "../api.js";

interface TaskTreeViewProps {
  runId: string;
  onApprove?: () => void;
}

const STATUS_LABEL: Record<TaskNodeStatus, string> = {
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  blocked: "blocked",
  cancelled: "cancelled",
};

/**
 * Task DAG view: groups sub-tasks into dependency-depth columns, shows each
 * node's status badge and dependencies, allows inline title/description edits,
 * cancellation, and approval of the whole plan.
 */
export function TaskTreeView({ runId, onApprove }: TaskTreeViewProps): JSX.Element {
  const [nodes, setNodes] = useState<TaskNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setNodes(await api.getTaskTree(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(() => groupByDepth(nodes), [nodes]);

  const saveNode = useCallback(
    async (id: string, title: string, description: string) => {
      setError(null);
      try {
        await api.editTaskNode(id, { title, description });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const cancelNode = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await api.cancelTaskNode(id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const approve = useCallback(async () => {
    setError(null);
    try {
      await api.approveTaskTree(runId);
      onApprove?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, onApprove, load]);

  return (
    <div className="task-tree">
      <div className="task-tree-head">
        <button className="primary" onClick={() => void approve()} disabled={nodes.length === 0}>
          Approve plan
        </button>
        <span className="iter-meta">{nodes.length} tasks</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {nodes.length === 0 ? (
        <div className="empty">No task breakdown for this run.</div>
      ) : (
        <div className="task-columns">
          {columns.map((column, depth) => (
            <div key={depth} className="task-column">
              <div className="task-column-label">depth {depth}</div>
              {column.map((node) => (
                <TaskNodeCard
                  key={node.id}
                  node={node}
                  onSave={(title, description) => void saveNode(node.id, title, description)}
                  onCancel={() => void cancelNode(node.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TaskNodeCardProps {
  node: TaskNode;
  onSave: (title: string, description: string) => void;
  onCancel: () => void;
}

function TaskNodeCard({ node, onSave, onCancel }: TaskNodeCardProps): JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(node.title);
  const [description, setDescription] = useState<string>(node.description);

  const save = (): void => {
    onSave(title.trim(), description.trim());
    setEditing(false);
  };

  return (
    <div className={`task-node task-${node.status}`}>
      {editing ? (
        <>
          <input className="mem-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            className="mem-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="row">
            <button className="ok" onClick={save}>
              Save
            </button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="task-node-head">
            <strong>{node.title}</strong>
            <span className={`task-badge task-${node.status}`}>{STATUS_LABEL[node.status]}</span>
          </div>
          {node.description && <p className="mem-body">{node.description}</p>}
          {node.dependsOn.length > 0 && (
            <div className="iter-meta">depends on: {node.dependsOn.join(", ")}</div>
          )}
          <div className="row">
            <button onClick={() => setEditing(true)}>Edit</button>
            <button className="danger" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Group nodes into columns by their longest dependency chain (depth). */
function groupByDepth(nodes: TaskNode[]): TaskNode[][] {
  const byId = new Map<string, TaskNode>(nodes.map((n) => [n.id, n]));
  const depthCache = new Map<string, number>();

  const depthOf = (id: string, seen: Set<string>): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node || node.dependsOn.length === 0 || seen.has(id)) {
      depthCache.set(id, 0);
      return 0;
    }
    seen.add(id);
    const d = 1 + Math.max(...node.dependsOn.map((dep) => depthOf(dep, seen)));
    seen.delete(id);
    depthCache.set(id, d);
    return d;
  };

  const columns: TaskNode[][] = [];
  for (const node of nodes) {
    const d = depthOf(node.id, new Set<string>());
    (columns[d] ??= []).push(node);
  }
  return columns.map((c) => c ?? []);
}
