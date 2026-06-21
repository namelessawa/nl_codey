import type {
  AgentTool,
  ApproveChangeInput,
  ApproveChangeOutput,
  RequestChangesInput,
  RequestChangesOutput,
  RequestReviewInput,
  RequestReviewOutput,
} from "@nlc/shared";
import type { ReviewPort } from "./phase3-deps.js";

/**
 * request_review (Coder -> Reviewer): hand a TaskNode's diff and test output
 * to the Reviewer role for evaluation.
 */
export function createRequestReviewTool(
  port: ReviewPort,
): AgentTool<RequestReviewInput, RequestReviewOutput> {
  return {
    name: "request_review",
    description: "将当前 TaskNode 的 diff 与测试输出提交给 Reviewer 角色进行审查。",
    run(input) {
      return port.requestReview(input);
    },
  };
}

/**
 * approve_change (Reviewer): approve a TaskNode's changes.
 */
export function createApproveChangeTool(
  port: ReviewPort,
): AgentTool<ApproveChangeInput, ApproveChangeOutput> {
  return {
    name: "approve_change",
    description: "批准某个 TaskNode 的变更，可附带审查说明。",
    run(input) {
      return port.approve(input);
    },
  };
}

/**
 * request_changes (Reviewer): reject with structured, file/line-anchored
 * comments that the Coder must address.
 */
export function createRequestChangesTool(
  port: ReviewPort,
): AgentTool<RequestChangesInput, RequestChangesOutput> {
  return {
    name: "request_changes",
    description:
      "对某个 TaskNode 请求修改，附带结构化评论（文件、行号、严重级别 warning/blocker、消息）。",
    run(input) {
      return port.requestChanges(input);
    },
  };
}
