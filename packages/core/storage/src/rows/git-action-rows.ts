/** Git-action audit row converter. */

import type { GitAction, GitActionKind } from "@nlc/shared";

export type GitActionRow = {
  id: string;
  run_id: string;
  action: string;
  ref: string | null;
  payload: string | null;
  created_at: number;
};

export function toGitAction(row: GitActionRow): GitAction {
  return {
    id: row.id,
    runId: row.run_id,
    action: row.action as GitActionKind,
    ...(row.ref !== null ? { ref: row.ref } : {}),
    ...(row.payload !== null ? { payload: row.payload } : {}),
    createdAt: row.created_at,
  };
}
