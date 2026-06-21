/** Proactive proposal types: tech-debt scan results queued in the inbox. */

export type ProposalKind =
  | "refactor"
  | "add_tests"
  | "tech_debt"
  | "dependency_update"
  | "doc_gap";
export type ProposalEffort = "S" | "M" | "L";
export type ProposalStatus = "new" | "snoozed" | "dismissed" | "converted_to_task";

export type Proposal = {
  id: string;
  workspaceId: string;
  kind: ProposalKind;
  title: string;
  rationale: string;
  estimatedEffort: ProposalEffort;
  affectedFiles: string[];
  status: ProposalStatus;
  /** When snoozed, the timestamp it should reappear. */
  snoozedUntil: number | null;
  /** Set when status transitions to converted_to_task. */
  convertedRunId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProposalInput = Omit<
  Proposal,
  "id" | "status" | "snoozedUntil" | "convertedRunId" | "createdAt" | "updatedAt"
>;
