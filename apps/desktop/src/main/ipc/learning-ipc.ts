/** Learning IPC handlers: feedback signals + preference-dataset curation. */

import { IPC } from "@nlc/shared";
import { buildDatasetFromSignals, curatePairs } from "@nlc/learning";
import {
  validateBuildPreferenceDataset,
  validateRecordFeedbackSignal,
  validateWorkspaceId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import type { Services } from "../services.js";

export function registerLearningIpc(services: Services): void {
  const { storage } = services;

  handle(IPC.listFeedbackSignals, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return storage.learning.listFeedbackSignals(workspaceId);
  });
  handle(IPC.recordFeedbackSignal, (raw) => {
    const { signal } = validateRecordFeedbackSignal(raw);
    return storage.learning.createFeedbackSignal(signal);
  });
  handle(IPC.buildPreferenceDataset, (raw) => {
    const { workspaceId, name } = validateBuildPreferenceDataset(raw);
    const signals = storage.learning.listFeedbackSignals(workspaceId);
    const result = buildDatasetFromSignals(storage.learning, signals, { name });
    const dataset = storage.learning.getPreferenceDataset(result.dataset.id);
    const curated = curatePairs(dataset?.pairs ?? []);
    // Persist the curated set back over the raw pairs. Without this rewrite
    // the IPC merely reported a `rejected` count while the underlying table
    // still held every raw entry, so downstream training silently consumed
    // pre-curation pairs even though the UI claimed they had been filtered.
    storage.learning.replacePreferenceDatasetPairs(result.dataset.id, curated.kept);
    return {
      datasetId: result.dataset.id,
      built: result.built,
      rejected:
        result.rejected +
        curated.droppedFormatting +
        curated.droppedTooSimilar +
        curated.droppedLowQuality +
        curated.droppedDuplicates,
    };
  });
  handle(IPC.listPreferenceDatasets, () => storage.learning.listPreferenceDatasets());
}
