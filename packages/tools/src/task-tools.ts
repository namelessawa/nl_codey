import type {
  AgentTool,
  ProposeTaskBreakdownInput,
  ProposeTaskBreakdownOutput,
  UpdateTaskStatusInput,
  UpdateTaskStatusOutput,
} from "@nlc/shared";
import type { TaskPort } from "./phase3-deps.js";

/**
 * propose_task_breakdown (Planner): submit a TaskNode DAG for validation and
 * registration. Acceptance and cycle/dependency checks live behind the port.
 */
export function createProposeTaskBreakdownTool(
  port: TaskPort,
): AgentTool<ProposeTaskBreakdownInput, ProposeTaskBreakdownOutput> {
  return {
    name: "propose_task_breakdown",
    description:
      "提交一个任务分解 DAG（TaskNode 列表，含依赖关系）。返回是否被接受、任务数量以及发现的问题。",
    run(input) {
      return port.proposeBreakdown(input);
    },
  };
}

/**
 * update_task_status (Coder): report the current TaskNode's lifecycle status.
 */
export function createUpdateTaskStatusTool(
  port: TaskPort,
): AgentTool<UpdateTaskStatusInput, UpdateTaskStatusOutput> {
  return {
    name: "update_task_status",
    description:
      "更新当前 TaskNode 的状态（running / succeeded / failed / blocked），可附带说明。",
    run(input) {
      return port.updateStatus(input);
    },
  };
}
