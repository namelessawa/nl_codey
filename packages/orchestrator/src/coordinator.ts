/**
 * The control spine of the controlled multi-agent loop. The Coordinator plans
 * (Planner), waits for approval, then drives the schedule wave by wave: handing
 * each ready node to the Coder, running the coder<->reviewer loop, and escalating
 * to a human on review exhaustion or node failure.
 *
 * It owns NO infrastructure: agent-core / storage access is injected via ports.
 */

import { Scheduler, validateBreakdown, materializeNodes } from "@coding-agent/planner";
import type {
  ReviewComment,
  ReviewResult,
  TaskBreakdown,
  TaskNode,
  TaskNodeStatus,
} from "@coding-agent/shared";

import type { MessageBus } from "./message-bus.js";
import { runReviewLoop } from "./review-loop.js";

export type CoordinatorPorts = {
  /** Planner role: decompose the user task into a DAG. */
  plan: (userTask: string) => Promise<TaskBreakdown>;
  /** Coder role: implement one node (optionally addressing review comments). */
  runCoder: (
    node: TaskNode,
    reviewComments?: ReviewComment[],
  ) => Promise<{ diff: string; testOutput: string }>;
  /** Reviewer role: judge a diff + test output. */
  runReviewer: (
    node: TaskNode,
    diff: string,
    testOutput: string,
  ) => Promise<ReviewResult>;
  /** Persist a freshly materialized node. */
  persistNode: (node: TaskNode) => void;
  /** Record a node status transition. */
  updateNode: (id: string, status: TaskNodeStatus) => void;
  /** Structured message bus. */
  bus: MessageBus;
  /** Human gate after a node exhausts review iterations or fails. */
  askHuman: (node: TaskNode, reason: string) => Promise<"retry" | "skip" | "cancel">;
  /** Human gate on the proposed plan before any execution. */
  approve: () => Promise<boolean>;
};

export type CoordinatorResult = {
  nodes: TaskNode[];
  status: "done" | "blocked" | "cancelled";
};

export class Coordinator {
  constructor(private readonly ports: CoordinatorPorts) {}

  async run(parentRunId: string, userTask: string): Promise<CoordinatorResult> {
    const breakdown = await this.ports.plan(userTask);

    const issues = validateBreakdown(breakdown);
    if (issues.length > 0) {
      throw new Error(`Invalid task breakdown: ${issues.join(" ")}`);
    }

    // Planner -> Orchestrator: the validated DAG proposal.
    this.ports.bus.send({
      taskNodeId: breakdown.root,
      fromRole: "planner",
      toRole: "orchestrator",
      kind: "breakdown",
      payload: { breakdown },
    });

    const nodes = materializeNodes(parentRunId, breakdown);
    for (const node of nodes) this.ports.persistNode(node);

    const approved = await this.ports.approve();
    if (!approved) {
      return { nodes, status: "cancelled" };
    }

    return this.executeWaves(nodes);
  }

  /** Drive the schedule until every node reaches a terminal state. */
  private async executeWaves(nodes: TaskNode[]): Promise<CoordinatorResult> {
    const scheduler = new Scheduler(nodes);
    let cancelled = false;

    while (!cancelled && !scheduler.isComplete()) {
      const ready = scheduler.ready();
      if (ready.length === 0) break; // nothing runnable (all remaining blocked)

      for (const node of ready) {
        const decision = await this.processNode(scheduler, node);
        if (decision === "cancel") {
          cancelled = true;
          break;
        }
      }
    }

    if (cancelled) {
      const finalNodes = this.cancelRemaining(scheduler);
      return { nodes: finalNodes, status: "cancelled" };
    }

    const status = scheduler.allDone() ? "done" : "blocked";
    return { nodes: scheduler.all(), status };
  }

  /** Run one node through handoff -> review loop, applying the resulting status. */
  private async processNode(
    scheduler: Scheduler,
    node: TaskNode,
  ): Promise<"continue" | "cancel"> {
    scheduler.markRunning(node.id);
    this.ports.updateNode(node.id, "running");

    // Orchestrator -> Coder: assign this node.
    this.ports.bus.send({
      taskNodeId: node.id,
      fromRole: "orchestrator",
      toRole: "coder",
      kind: "handoff",
      payload: { taskNodeId: node.id },
    });

    let outcome;
    try {
      outcome = await runReviewLoop(node, this.ports);
    } catch (err) {
      return this.escalate(scheduler, node, `Node failed: ${errorMessage(err)}`);
    }

    if (outcome.kind === "approved") {
      scheduler.markSucceeded(node.id);
      this.ports.updateNode(node.id, "succeeded");
      return "continue";
    }

    // Review iterations exhausted without approval -> ask the human.
    return this.escalate(
      scheduler,
      node,
      "Review iterations exhausted without approval.",
    );
  }

  /** Human-gated recovery: retry the node, skip (cascade-block), or cancel all. */
  private async escalate(
    scheduler: Scheduler,
    node: TaskNode,
    reason: string,
  ): Promise<"continue" | "cancel"> {
    const choice = await this.ports.askHuman(node, reason);

    if (choice === "retry") {
      try {
        const outcome = await runReviewLoop(node, this.ports);
        if (outcome.kind === "approved") {
          scheduler.markSucceeded(node.id);
          this.ports.updateNode(node.id, "succeeded");
          return "continue";
        }
      } catch {
        // fall through to blocking the node below
      }
      this.blockNode(scheduler, node);
      return "continue";
    }

    if (choice === "skip") {
      this.blockNode(scheduler, node);
      return "continue";
    }

    // cancel: abort the whole run.
    return "cancel";
  }

  /** Fail a node and cascade-block its dependents, mirroring status to storage. */
  private blockNode(scheduler: Scheduler, node: TaskNode): void {
    scheduler.markFailed(node.id, true);
    this.ports.updateNode(node.id, "failed");
    // Mirror cascade-blocked dependents to storage.
    for (const n of scheduler.all()) {
      if (n.id !== node.id && n.status === "blocked") {
        this.ports.updateNode(n.id, "blocked");
      }
    }
  }

  /**
   * On cancel, mark every non-terminal node cancelled in storage and return the
   * final node set with those nodes reflected as "cancelled" (the Scheduler has
   * no cancelled state, so we project it onto the returned snapshots).
   */
  private cancelRemaining(scheduler: Scheduler): TaskNode[] {
    return scheduler.all().map((n) => {
      if (n.status === "pending" || n.status === "running") {
        this.ports.updateNode(n.id, "cancelled");
        return { ...n, status: "cancelled" as TaskNodeStatus };
      }
      return n;
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
