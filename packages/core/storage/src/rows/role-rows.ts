/** Role-message DB row converter (Planner/Coder/Reviewer history). */

import type {
  AgentRole,
  RoleMessageKind,
  RoleMessageRow,
} from "@nlc/shared";

export type RoleMessageDbRow = {
  id: string;
  task_node_id: string;
  from_role: string;
  to_role: string;
  kind: string;
  payload: string;
  created_at: number;
};

export function toRoleMessageRow(row: RoleMessageDbRow): RoleMessageRow {
  return {
    id: row.id,
    taskNodeId: row.task_node_id,
    fromRole: row.from_role as AgentRole,
    toRole: row.to_role as AgentRole,
    kind: row.kind as RoleMessageKind,
    payload: row.payload,
    createdAt: row.created_at,
  };
}
