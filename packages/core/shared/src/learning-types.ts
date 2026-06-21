/** Learning-loop types: feedback signals + preference datasets. */

export type FeedbackSignalKind =
  | "diff_accepted"
  | "diff_rejected"
  | "diff_edited"
  | "review_overturned"
  | "manual_correction";

export type FeedbackSignal = {
  id: string;
  workspaceId: string;
  runId: string;
  taskNodeId: string | null;
  kind: FeedbackSignalKind;
  /** Agent's pre-edit version (always present). */
  before: string;
  /** Human's edited version when applicable. */
  after: string | null;
  reason: string | null;
  /** Path of the file the signal relates to (for grouping). */
  filePath: string | null;
  createdAt: number;
};

export type FeedbackSignalInput = Omit<FeedbackSignal, "id" | "createdAt">;

/** A (prompt, chosen, rejected) tuple suitable for preference fine-tuning. */
export type PreferencePair = {
  id: string;
  /** The original task / context block used as prompt. */
  prompt: string;
  /** Preferred completion (typically the human edit). */
  chosen: string;
  /** Rejected completion (typically the agent's raw output). */
  rejected: string;
  /** Optional category for stratified sampling. */
  category: string | null;
  /** Quality score from curator: lower = noisier. */
  qualityScore: number;
  /** Signal id this pair was distilled from. */
  signalId: string;
  createdAt: number;
};

export type PreferenceDataset = {
  id: string;
  name: string;
  pairs: PreferencePair[];
  /**
   * Total pair count when known. The list endpoint sets this without loading
   * the full `pairs` array (wasteful for many-row datasets); the
   * single-dataset endpoint omits it since `pairs.length` is authoritative
   * there. Renderers should display `pairCount ?? pairs.length`.
   */
  pairCount?: number;
  /** Filtering applied during curation. */
  curationNotes: string;
  createdAt: number;
};
