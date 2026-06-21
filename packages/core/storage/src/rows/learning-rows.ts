/** Learning-loop row converters: feedback signals + preference pairs/datasets. */

import type { FeedbackSignal, PreferencePair, PreferenceDataset } from "@nlc/shared";

export type FeedbackSignalRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  task_node_id: string | null;
  kind: string;
  before_text: string;
  after_text: string | null;
  reason: string | null;
  file_path: string | null;
  created_at: number;
};

export function toFeedbackSignal(r: FeedbackSignalRow): FeedbackSignal {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    runId: r.run_id,
    taskNodeId: r.task_node_id,
    kind: r.kind as FeedbackSignal["kind"],
    before: r.before_text,
    after: r.after_text,
    reason: r.reason,
    filePath: r.file_path,
    createdAt: r.created_at,
  };
}

export type PreferencePairRow = {
  id: string;
  dataset_id: string;
  prompt: string;
  chosen: string;
  rejected: string;
  category: string | null;
  quality_score: number;
  signal_id: string;
  created_at: number;
};

export function toPreferencePair(r: PreferencePairRow): PreferencePair {
  return {
    id: r.id,
    prompt: r.prompt,
    chosen: r.chosen,
    rejected: r.rejected,
    category: r.category,
    qualityScore: r.quality_score,
    signalId: r.signal_id,
    createdAt: r.created_at,
  };
}

export type PreferenceDatasetRow = {
  id: string;
  name: string;
  curation_notes: string;
  created_at: number;
};

export function toPreferenceDataset(
  r: PreferenceDatasetRow,
  pairs: PreferencePair[],
): PreferenceDataset {
  return {
    id: r.id,
    name: r.name,
    pairs,
    curationNotes: r.curation_notes,
    createdAt: r.created_at,
  };
}
