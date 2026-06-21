/** Learning store: feedback signals + preference datasets/pairs. */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  FeedbackSignal,
  FeedbackSignalInput,
  PreferenceDataset,
  PreferencePair,
} from "@nlc/shared";
import {
  toFeedbackSignal,
  toPreferenceDataset,
  toPreferencePair,
  type FeedbackSignalRow,
  type PreferenceDatasetRow,
  type PreferencePairRow,
} from "../rows/learning-rows.js";

export class LearningStore {
  constructor(private readonly db: Database.Database) {}

  createFeedbackSignal(input: FeedbackSignalInput): FeedbackSignal {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO feedback_signals
         (id, workspace_id, run_id, task_node_id, kind, before_text, after_text, reason, file_path, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.runId,
        input.taskNodeId,
        input.kind,
        input.before,
        input.after,
        input.reason,
        input.filePath,
        now,
      );
    return { ...input, id, createdAt: now };
  }

  listFeedbackSignals(workspaceId: string, limit = 500): FeedbackSignal[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM feedback_signals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as FeedbackSignalRow[];
    return rows.map(toFeedbackSignal);
  }

  createPreferenceDataset(name: string, notes: string): PreferenceDataset {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO preference_datasets (id, name, curation_notes, created_at) VALUES (?,?,?,?)")
      .run(id, name, notes, now);
    return { id, name, pairs: [], curationNotes: notes, createdAt: now };
  }

  appendPreferencePair(
    datasetId: string,
    pair: Omit<PreferencePair, "id" | "createdAt">,
  ): PreferencePair {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO preference_pairs (id, dataset_id, prompt, chosen, rejected, category, quality_score, signal_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        datasetId,
        pair.prompt,
        pair.chosen,
        pair.rejected,
        pair.category,
        pair.qualityScore,
        pair.signalId,
        now,
      );
    return { ...pair, id, createdAt: now };
  }

  getPreferenceDataset(id: string): PreferenceDataset | null {
    const row = this.db
      .prepare("SELECT * FROM preference_datasets WHERE id = ?")
      .get(id) as PreferenceDatasetRow | undefined;
    if (!row) return null;
    const pairs = (
      this.db
        .prepare("SELECT * FROM preference_pairs WHERE dataset_id = ? ORDER BY created_at ASC")
        .all(id) as PreferencePairRow[]
    ).map(toPreferencePair);
    return toPreferenceDataset(row, pairs);
  }

  listPreferenceDatasets(): PreferenceDataset[] {
    // Single aggregate join — without the COUNT(*) the renderer's "N 对"
    // counter always showed 0 (the list endpoint used to pass `[]` for
    // every dataset's pairs). Loading the full pairs array per dataset
    // would balloon the response on large training sets, so we pass the
    // count out-of-band via PreferenceDataset.pairCount.
    const rows = this.db
      .prepare(
        `SELECT pd.*, COUNT(pp.id) AS pair_count
         FROM preference_datasets pd
         LEFT JOIN preference_pairs pp ON pp.dataset_id = pd.id
         GROUP BY pd.id
         ORDER BY pd.created_at DESC`,
      )
      .all() as (PreferenceDatasetRow & { pair_count: number })[];
    return rows.map((r) => {
      const dataset = toPreferenceDataset(r, []);
      return { ...dataset, pairCount: r.pair_count };
    });
  }

  /**
   * Replace every pair in a dataset with the provided list, atomically. Used by
   * curation: buildDatasetFromSignals inserts the raw pairs, curatePairs filters
   * out duplicates / low-quality / over-similar entries, then this method
   * rewrites the table so subsequent training reads only the kept set.
   */
  replacePreferenceDatasetPairs(datasetId: string, pairs: PreferencePair[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM preference_pairs WHERE dataset_id = ?").run(datasetId);
      const ins = this.db.prepare(
        `INSERT INTO preference_pairs
           (id, dataset_id, prompt, chosen, rejected, category, quality_score, signal_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      const now = Date.now();
      for (const p of pairs) {
        ins.run(
          p.id,
          datasetId,
          p.prompt,
          p.chosen,
          p.rejected,
          p.category,
          p.qualityScore,
          p.signalId,
          p.createdAt || now,
        );
      }
    });
    tx();
  }
}
