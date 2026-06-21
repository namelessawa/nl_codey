/** Proactive-proposal row converter. */

import type { Proposal } from "@nlc/shared";

export type ProposalRow = {
  id: string;
  workspace_id: string;
  kind: string;
  title: string;
  rationale: string;
  estimated_effort: string;
  affected_files: string;
  status: string;
  snoozed_until: number | null;
  converted_run_id: string | null;
  created_at: number;
  updated_at: number;
};

export function toProposal(r: ProposalRow): Proposal {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    kind: r.kind as Proposal["kind"],
    title: r.title,
    rationale: r.rationale,
    estimatedEffort: r.estimated_effort as Proposal["estimatedEffort"],
    affectedFiles: JSON.parse(r.affected_files) as string[],
    status: r.status as Proposal["status"],
    snoozedUntil: r.snoozed_until,
    convertedRunId: r.converted_run_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
