/**
 * Distributed coordinator. Holds a TaskNode DAG, hands ready nodes to
 * registered worker nodes. Graceful degradation rule: if every worker is
 * offline, the coordinator falls back to single-node execution by handing
 * tasks to a local executor.
 *
 * Communication is abstracted via the {@link RemoteWorkerClient} port so we
 * can mock it in tests and swap mTLS transports later.
 */
import type {
  DistributedAssignment,
  TaskNode,
  TaskNodeStatus,
  WorkerNode,
} from "@nlc/shared";

export interface DistributedStore {
  upsertWorkerNode(node: Omit<WorkerNode, "registeredAt">): WorkerNode;
  listWorkerNodes(): WorkerNode[];
  recordAssignment(
    assignment: Omit<DistributedAssignment, "id">,
  ): DistributedAssignment;
  listAssignments(nodeId?: string): DistributedAssignment[];
}

export interface RemoteWorkerClient {
  /** Submit a task to a remote node. Resolves with terminal status. */
  submit(nodeId: string, task: TaskNode): Promise<TaskNodeStatus>;
  /** Best-effort ping. */
  ping(nodeId: string): Promise<boolean>;
}

export type CoordinatorOptions = {
  /** If true, coordinator may fall back to local execution. */
  allowLocalFallback?: boolean;
  /** Heartbeat ceiling before a node is considered offline (ms). */
  heartbeatMaxAgeMs?: number;
};

export class Coordinator {
  private readonly nodes = new Map<string, WorkerNode>();
  private readonly options: Required<CoordinatorOptions>;

  constructor(
    private readonly store: DistributedStore,
    private readonly client: RemoteWorkerClient,
    options: CoordinatorOptions = {},
  ) {
    this.options = {
      allowLocalFallback: options.allowLocalFallback ?? true,
      heartbeatMaxAgeMs: options.heartbeatMaxAgeMs ?? 30_000,
    };
    for (const node of store.listWorkerNodes()) this.nodes.set(node.id, node);
  }

  registerNode(node: Omit<WorkerNode, "registeredAt">): WorkerNode {
    const stored = this.store.upsertWorkerNode({
      ...node,
      lastHeartbeat: Date.now(),
    });
    this.nodes.set(stored.id, stored);
    return stored;
  }

  heartbeat(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.lastHeartbeat = Date.now();
    node.status = "online";
    this.store.upsertWorkerNode(node);
  }

  /** Mark all stale nodes offline; returns count. */
  reapStaleNodes(now = Date.now()): number {
    let reaped = 0;
    for (const node of this.nodes.values()) {
      if (now - node.lastHeartbeat > this.options.heartbeatMaxAgeMs) {
        node.status = "offline";
        this.store.upsertWorkerNode(node);
        reaped++;
      }
    }
    return reaped;
  }

  listNodes(): WorkerNode[] {
    return Array.from(this.nodes.values());
  }

  availableNodes(): WorkerNode[] {
    return this.listNodes().filter((n) => n.status === "online");
  }

  /** Pick the best node for a task — preferring fewer current assignments. */
  pickNode(): WorkerNode | null {
    const candidates = this.availableNodes();
    if (candidates.length === 0) return null;
    return candidates
      .slice()
      .sort((a, b) => a.activeAssignments.length - b.activeAssignments.length)[0]!;
  }

  /**
   * Assign a task to a worker. Returns assignment if remote dispatch succeeds,
   * null when no worker is available AND fallback is disabled (caller then
   * runs locally).
   */
  async assign(task: TaskNode): Promise<DistributedAssignment | null> {
    const node = this.pickNode();
    if (!node) {
      if (this.options.allowLocalFallback) {
        return this.store.recordAssignment({
          nodeId: "local",
          taskNodeId: task.id,
          status: "running",
          startedAt: Date.now(),
          finishedAt: null,
        });
      }
      return null;
    }
    const assignment = this.store.recordAssignment({
      nodeId: node.id,
      taskNodeId: task.id,
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
    });
    node.activeAssignments = [...node.activeAssignments, task.id];
    this.store.upsertWorkerNode(node);
    void this.client.submit(node.id, task).catch(() => {
      // Failures surface as node going offline + reassignment in the next sweep.
    });
    return assignment;
  }
}
