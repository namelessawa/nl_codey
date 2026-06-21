/**
 * The coder<->reviewer loop for a single TaskNode. Drives runCoder, emits the
 * review_request / review_result messages, and re-runs the coder on
 * changes_requested up to REVIEW_MAX_ITERATIONS before escalating to a human.
 */

import {
  REVIEW_MAX_ITERATIONS,
  type ReviewComment,
  type ReviewResult,
  type TaskNode,
} from "@nlc/shared";

import type { MessageBus } from "./message-bus.js";

export type ReviewLoopPorts = {
  runCoder: (
    node: TaskNode,
    reviewComments?: ReviewComment[],
  ) => Promise<{ diff: string; testOutput: string }>;
  runReviewer: (
    node: TaskNode,
    diff: string,
    testOutput: string,
  ) => Promise<ReviewResult>;
  bus: MessageBus;
};

export type ReviewLoopOutcome =
  | { kind: "approved"; result: ReviewResult; diff: string; testOutput: string }
  | { kind: "exhausted"; result: ReviewResult; diff: string; testOutput: string };

/**
 * Run the coder, request review, and iterate on changes_requested. Returns
 * "approved" as soon as the reviewer approves, or "exhausted" once the iteration
 * cap is hit with the last (still-rejecting) result.
 */
export async function runReviewLoop(
  node: TaskNode,
  ports: ReviewLoopPorts,
): Promise<ReviewLoopOutcome> {
  let comments: ReviewComment[] | undefined;
  let lastResult: ReviewResult | null = null;
  let lastDiff = "";
  let lastTestOutput = "";

  // Initial attempt (iteration 0) + up to REVIEW_MAX_ITERATIONS retries.
  for (let attempt = 0; attempt <= REVIEW_MAX_ITERATIONS; attempt++) {
    const { diff, testOutput } = await ports.runCoder(node, comments);
    lastDiff = diff;
    lastTestOutput = testOutput;

    ports.bus.send({
      taskNodeId: node.id,
      fromRole: "coder",
      toRole: "reviewer",
      kind: "review_request",
      payload: { taskNodeId: node.id, diff, testOutput },
    });

    const result = await ports.runReviewer(node, diff, testOutput);
    lastResult = result;

    ports.bus.send({
      taskNodeId: node.id,
      fromRole: "reviewer",
      toRole: "coder",
      kind: "review_result",
      payload: result,
    });

    if (result.verdict === "approved") {
      return { kind: "approved", result, diff, testOutput };
    }

    comments = result.comments;
  }

  return {
    kind: "exhausted",
    result: lastResult as ReviewResult,
    diff: lastDiff,
    testOutput: lastTestOutput,
  };
}
