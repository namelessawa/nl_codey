/**
 * Build preference (prompt, chosen, rejected) tuples from feedback signals.
 * The chosen completion is the human-edited version; the rejected one is the
 * agent's original. `diff_edited` is the highest-quality source.
 */
import type {
  FeedbackSignal,
  PreferenceDataset,
  PreferencePair,
} from "@coding-agent/shared";

export interface PreferenceStore {
  createPreferenceDataset(name: string, notes: string): PreferenceDataset;
  appendPreferencePair(
    datasetId: string,
    pair: Omit<PreferencePair, "id" | "createdAt">,
  ): PreferencePair;
  getPreferenceDataset(id: string): PreferenceDataset | null;
  listPreferenceDatasets(): PreferenceDataset[];
}

export type BuildOptions = {
  name?: string;
  notes?: string;
  /** Categorize pairs (e.g. by category derived from file path). */
  categoryOf?: (signal: FeedbackSignal) => string | null;
};

export function buildDatasetFromSignals(
  store: PreferenceStore,
  signals: FeedbackSignal[],
  options: BuildOptions = {},
): { dataset: PreferenceDataset; rejected: number; built: number } {
  const dataset = store.createPreferenceDataset(
    options.name ?? `signals-${signals.length}-${Date.now()}`,
    options.notes ?? "Built from FeedbackSignals via buildDatasetFromSignals",
  );

  let built = 0;
  let rejected = 0;
  for (const signal of signals) {
    if (!isUsableForPreference(signal)) {
      rejected++;
      continue;
    }
    const prompt = renderPrompt(signal);
    const chosen = signal.after!;
    const rejectedText = signal.before;
    const category = options.categoryOf?.(signal) ?? null;
    store.appendPreferencePair(dataset.id, {
      prompt,
      chosen,
      rejected: rejectedText,
      category,
      qualityScore: initialQualityScore(signal),
      signalId: signal.id,
    });
    built++;
  }
  return { dataset, rejected, built };
}

export function isUsableForPreference(signal: FeedbackSignal): boolean {
  // Need both before and after; accepted signals have no contrast.
  if (signal.kind === "diff_accepted") return false;
  if (!signal.before || !signal.after) return false;
  if (signal.before === signal.after) return false;
  // Filter very short edits (likely formatting churn).
  if (Math.abs(signal.before.length - signal.after.length) < 4) return false;
  return true;
}

export function renderPrompt(signal: FeedbackSignal): string {
  const filePart = signal.filePath ? `File: ${signal.filePath}\n` : "";
  const reasonPart = signal.reason ? `User reason: ${signal.reason}\n` : "";
  return `${filePart}${reasonPart}Task: produce an edit that the user would accept without modification.`;
}

export function initialQualityScore(signal: FeedbackSignal): number {
  let score = 0.5;
  // Signals with explicit reasons get a quality bump.
  if (signal.reason && signal.reason.length > 0) score += 0.2;
  if (signal.kind === "manual_correction") score += 0.1;
  if (signal.kind === "review_overturned") score += 0.1;
  return Math.min(1, score);
}
