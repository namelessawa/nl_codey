/** Task-node row converter. */

import type { TaskNode, TaskNodeStatus } from "@nlc/shared";
import { safeParseStringArray } from "./memory-rows.js";

export type TaskNodeRow = {
  id: string;
  parent_run_id: string;
  title: string;
  description: string;
  status: string;
  depends_on: string;
  verify_command: string | null;
  files_scope: string | null;
  sub_run_id: string | null;
  created_at: number;
  updated_at: number;
};

export function toTaskNode(row: TaskNodeRow): TaskNode {
  return {
    id: row.id,
    parentRunId: row.parent_run_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskNodeStatus,
    dependsOn: safeParseStringArray(row.depends_on),
    ...(row.verify_command !== null ? { verifyCommand: row.verify_command } : {}),
    ...(row.files_scope !== null ? { filesScope: safeParseStringArray(row.files_scope) } : {}),
    ...(row.sub_run_id !== null ? { subRunId: row.sub_run_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
