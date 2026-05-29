/**
 * Inbox facade — what the GUI calls. Backed by the storage port; this is
 * where snooze/dismiss/convert transitions live. Converting a proposal hands
 * it off to the Phase 3 Planner pipeline, which is the only place a real task
 * is created.
 */
import type {
  Proposal,
  ProposalInput,
  ProposalStatus,
} from "@coding-agent/shared";

export interface ProposalStore {
  createProposal(input: ProposalInput): Proposal;
  getProposal(id: string): Proposal | null;
  listProposals(workspaceId: string, status?: ProposalStatus): Proposal[];
  updateProposalStatus(
    id: string,
    status: ProposalStatus,
    extras?: { snoozedUntil?: number | null; convertedRunId?: string | null },
  ): Proposal | null;
}

export class ProposalInbox {
  constructor(private readonly store: ProposalStore) {}

  ingest(input: ProposalInput): Proposal {
    return this.store.createProposal(input);
  }

  ingestMany(inputs: ProposalInput[]): Proposal[] {
    return inputs.map((i) => this.ingest(i));
  }

  list(workspaceId: string, status?: ProposalStatus): Proposal[] {
    return this.store.listProposals(workspaceId, status);
  }

  dismiss(id: string): Proposal | null {
    return this.store.updateProposalStatus(id, "dismissed");
  }

  snooze(id: string, untilTs: number): Proposal | null {
    return this.store.updateProposalStatus(id, "snoozed", { snoozedUntil: untilTs });
  }

  /**
   * Convert a proposal into a real task. Returns the new run id (provided by
   * caller — typically the Phase 3 Planner pipeline). The proposal stays in
   * the inbox marked as converted so the user can trace what shipped from
   * what suggestion.
   */
  convert(id: string, newRunId: string): Proposal | null {
    return this.store.updateProposalStatus(id, "converted_to_task", {
      convertedRunId: newRunId,
    });
  }

  /** Filter snoozed proposals whose timer has elapsed and move them back to `new`. */
  rewakeSnoozed(workspaceId: string, now = Date.now()): Proposal[] {
    const snoozed = this.list(workspaceId, "snoozed");
    const rewoken: Proposal[] = [];
    for (const p of snoozed) {
      if (p.snoozedUntil !== null && p.snoozedUntil <= now) {
        const updated = this.store.updateProposalStatus(p.id, "new", {
          snoozedUntil: null,
        });
        if (updated) rewoken.push(updated);
      }
    }
    return rewoken;
  }
}
