/**
 * Signal collector. The GUI calls `record*` helpers on every accept/reject/edit
 * — this happens in the IPC layer so the user never types extra annotations.
 *
 * Zero extra burden: we capture the agent's `before` and the human's `after`
 * (when applicable). The `reason` is optional and only filled when the user
 * provides one explicitly via the diff comment field.
 */
import type {
  FeedbackSignal,
  FeedbackSignalInput,
  FeedbackSignalKind,
} from "@nlc/shared";

export interface SignalStore {
  createFeedbackSignal(input: FeedbackSignalInput): FeedbackSignal;
  listFeedbackSignals(workspaceId: string, limit?: number): FeedbackSignal[];
}

export class SignalCollector {
  constructor(private readonly store: SignalStore) {}

  recordAccepted(args: {
    workspaceId: string;
    runId: string;
    taskNodeId: string | null;
    filePath: string | null;
    agentVersion: string;
    reason?: string | null;
  }): FeedbackSignal {
    return this.store.createFeedbackSignal({
      workspaceId: args.workspaceId,
      runId: args.runId,
      taskNodeId: args.taskNodeId,
      kind: "diff_accepted",
      before: args.agentVersion,
      after: null,
      reason: args.reason ?? null,
      filePath: args.filePath,
    });
  }

  recordRejected(args: {
    workspaceId: string;
    runId: string;
    taskNodeId: string | null;
    filePath: string | null;
    agentVersion: string;
    reason?: string | null;
  }): FeedbackSignal {
    return this.store.createFeedbackSignal({
      workspaceId: args.workspaceId,
      runId: args.runId,
      taskNodeId: args.taskNodeId,
      kind: "diff_rejected",
      before: args.agentVersion,
      after: null,
      reason: args.reason ?? null,
      filePath: args.filePath,
    });
  }

  recordEdited(args: {
    workspaceId: string;
    runId: string;
    taskNodeId: string | null;
    filePath: string | null;
    agentVersion: string;
    humanVersion: string;
    reason?: string | null;
  }): FeedbackSignal {
    return this.store.createFeedbackSignal({
      workspaceId: args.workspaceId,
      runId: args.runId,
      taskNodeId: args.taskNodeId,
      kind: "diff_edited",
      before: args.agentVersion,
      after: args.humanVersion,
      reason: args.reason ?? null,
      filePath: args.filePath,
    });
  }

  recordReviewOverturn(args: {
    workspaceId: string;
    runId: string;
    taskNodeId: string;
    reviewerVerdict: string;
    finalVerdict: string;
    reason?: string | null;
  }): FeedbackSignal {
    return this.store.createFeedbackSignal({
      workspaceId: args.workspaceId,
      runId: args.runId,
      taskNodeId: args.taskNodeId,
      kind: "review_overturned",
      before: args.reviewerVerdict,
      after: args.finalVerdict,
      reason: args.reason ?? null,
      filePath: null,
    });
  }

  recordManualCorrection(args: {
    workspaceId: string;
    runId: string;
    taskNodeId: string | null;
    filePath: string | null;
    agentVersion: string;
    humanVersion: string;
    reason?: string | null;
  }): FeedbackSignal {
    return this.store.createFeedbackSignal({
      workspaceId: args.workspaceId,
      runId: args.runId,
      taskNodeId: args.taskNodeId,
      kind: "manual_correction",
      before: args.agentVersion,
      after: args.humanVersion,
      reason: args.reason ?? null,
      filePath: args.filePath,
    });
  }

  list(workspaceId: string, limit?: number): FeedbackSignal[] {
    return this.store.listFeedbackSignals(workspaceId, limit);
  }
}

/** Per-kind tally for the LearningDashboard. */
export function aggregateByKind(
  signals: FeedbackSignal[],
): Record<FeedbackSignalKind, number> {
  const out: Record<FeedbackSignalKind, number> = {
    diff_accepted: 0,
    diff_rejected: 0,
    diff_edited: 0,
    review_overturned: 0,
    manual_correction: 0,
  };
  for (const s of signals) out[s.kind]++;
  return out;
}
