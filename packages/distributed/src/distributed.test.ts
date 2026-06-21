import { describe, expect, it } from "vitest";
import type {
  DistributedAssignment,
  TaskNode,
  TaskNodeStatus,
  WorkerNode,
} from "@nlc/shared";
import { Coordinator, type RemoteWorkerClient } from "./coordinator.js";
import { planDistribution, readyTasks } from "./task-distributor.js";
import { detectFailedNodes, planReassignments } from "./node-recovery.js";

function node(id: string, status: WorkerNode["status"] = "online", load = 0): WorkerNode {
  return {
    id,
    hostname: id,
    endpoint: `https://${id}:9000`,
    status,
    capabilities: ["whitelist"],
    activeAssignments: Array.from({ length: load }).map((_, i) => `t-${i}`),
    lastHeartbeat: Date.now(),
    registeredAt: Date.now(),
  };
}

function task(id: string, deps: string[] = [], status: TaskNodeStatus = "pending"): TaskNode {
  return {
    id,
    parentRunId: "r",
    title: id,
    description: id,
    status,
    dependsOn: deps,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeStore() {
  const nodes = new Map<string, WorkerNode>();
  const assignments: DistributedAssignment[] = [];
  let assignmentCounter = 0;
  return {
    nodes,
    assignments,
    upsertWorkerNode(n: Omit<WorkerNode, "registeredAt">) {
      const existing = nodes.get(n.id);
      const stored: WorkerNode = {
        ...n,
        registeredAt: existing?.registeredAt ?? Date.now(),
      };
      nodes.set(n.id, stored);
      return stored;
    },
    listWorkerNodes() {
      return Array.from(nodes.values());
    },
    recordAssignment(a: Omit<DistributedAssignment, "id">) {
      const stamped: DistributedAssignment = { ...a, id: `a-${assignmentCounter++}` };
      assignments.push(stamped);
      return stamped;
    },
    listAssignments(nodeId?: string) {
      return nodeId ? assignments.filter((a) => a.nodeId === nodeId) : [...assignments];
    },
  };
}

const stubClient: RemoteWorkerClient = {
  submit: async () => "succeeded",
  ping: async () => true,
};

describe("Coordinator", () => {
  it("picks least-loaded online node", () => {
    const store = makeStore();
    const c = new Coordinator(store, stubClient);
    c.registerNode(node("n1", "online", 2));
    c.registerNode(node("n2", "online", 0));
    expect(c.pickNode()?.id).toBe("n2");
  });

  it("falls back to local execution when no workers available", async () => {
    const store = makeStore();
    const c = new Coordinator(store, stubClient, { allowLocalFallback: true });
    const assignment = await c.assign(task("t1"));
    expect(assignment?.nodeId).toBe("local");
  });

  it("returns null when no workers and fallback disabled", async () => {
    const store = makeStore();
    const c = new Coordinator(store, stubClient, { allowLocalFallback: false });
    const assignment = await c.assign(task("t1"));
    expect(assignment).toBeNull();
  });

  it("reapStaleNodes marks long-silent nodes offline", () => {
    const store = makeStore();
    const c = new Coordinator(store, stubClient, { heartbeatMaxAgeMs: 100 });
    const stale = node("n1");
    stale.lastHeartbeat = Date.now() - 200;
    store.upsertWorkerNode(stale);
    const c2 = new Coordinator(store, stubClient, { heartbeatMaxAgeMs: 100 });
    expect(c2.reapStaleNodes()).toBe(1);
    expect(c2.listNodes()[0]?.status).toBe("offline");
    void c;
  });
});

describe("task-distributor", () => {
  it("readyTasks returns only those whose deps are completed", () => {
    const all = [task("t1"), task("t2", ["t1"]), task("t3", ["t2"])];
    expect(readyTasks(all, new Set())).toHaveLength(1);
    expect(readyTasks(all, new Set(["t1"]))).toHaveLength(1);
    expect(readyTasks(all, new Set(["t1", "t2"]))).toHaveLength(1);
  });

  it("planDistribution round-robins least-loaded", () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const nodes = [node("n1", "online", 0), node("n2", "online", 0)];
    const plan = planDistribution(tasks, nodes);
    const a = plan.perNode.get("n1")?.length ?? 0;
    const b = plan.perNode.get("n2")?.length ?? 0;
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    expect(plan.unassigned).toHaveLength(0);
  });

  it("planDistribution leaves tasks unassigned when no node has capability", () => {
    const tasks = [task("t1")];
    const nodes = [node("n1")];
    const plan = planDistribution(tasks, nodes, () => ["docker"]);
    expect(plan.unassigned).toHaveLength(1);
  });
});

describe("node-recovery", () => {
  it("detects offline + stale nodes", () => {
    const fresh = node("n1");
    const stale = node("n2");
    stale.lastHeartbeat = Date.now() - 60_000;
    expect(detectFailedNodes([fresh, stale], Date.now(), 30_000)).toHaveLength(1);
  });

  it("reassigns failed-node assignments to surviving nodes", () => {
    const failed = node("n1", "offline");
    const survivor = node("n2", "online", 0);
    const assignments: DistributedAssignment[] = [
      {
        id: "a1",
        nodeId: "n1",
        taskNodeId: "t1",
        status: "running",
        startedAt: 0,
        finishedAt: null,
      },
    ];
    const decisions = planReassignments([failed], assignments, [survivor]);
    expect(decisions[0]?.reassignTo).toBe("n2");
  });
});
