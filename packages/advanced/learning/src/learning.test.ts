import { describe, expect, it } from "vitest";
import type { FeedbackSignal, PreferenceDataset, PreferencePair } from "@nlc/shared";
import { SignalCollector, aggregateByKind } from "./signal-collector.js";
import { buildDatasetFromSignals, isUsableForPreference } from "./preference-dataset.js";
import { curatePairs, normalizedEditDistance } from "./dataset-curator.js";

function makeSignalStore() {
  const records: FeedbackSignal[] = [];
  return {
    records,
    createFeedbackSignal: (input: Omit<FeedbackSignal, "id" | "createdAt">) => {
      const stamped: FeedbackSignal = {
        ...input,
        id: `sig-${records.length}`,
        createdAt: Date.now(),
      };
      records.push(stamped);
      return stamped;
    },
    listFeedbackSignals: (workspaceId: string) =>
      records.filter((r) => r.workspaceId === workspaceId),
  };
}

function makePrefStore() {
  let dataset: PreferenceDataset | null = null;
  const pairs: PreferencePair[] = [];
  return {
    createPreferenceDataset(name: string, notes: string) {
      dataset = {
        id: "ds-1",
        name,
        pairs: [],
        curationNotes: notes,
        createdAt: Date.now(),
      };
      return dataset;
    },
    appendPreferencePair(_datasetId: string, pair: Omit<PreferencePair, "id" | "createdAt">) {
      const stamped: PreferencePair = {
        ...pair,
        id: `pair-${pairs.length}`,
        createdAt: Date.now(),
      };
      pairs.push(stamped);
      return stamped;
    },
    getPreferenceDataset() {
      if (!dataset) return null;
      return { ...dataset, pairs };
    },
    listPreferenceDatasets: () => (dataset ? [dataset] : []),
  };
}

describe("SignalCollector", () => {
  it("records edited signals with both before and after", () => {
    const store = makeSignalStore();
    const collector = new SignalCollector(store);
    const result = collector.recordEdited({
      workspaceId: "w",
      runId: "r",
      taskNodeId: null,
      filePath: "src/x.ts",
      agentVersion: "try { x() } catch (e) {}",
      humanVersion: "Result<void, Error>",
    });
    expect(result.kind).toBe("diff_edited");
    expect(result.after).toBe("Result<void, Error>");
  });

  it("aggregateByKind tallies all five kinds", () => {
    const signals: FeedbackSignal[] = [
      mockSignal("diff_accepted"),
      mockSignal("diff_rejected"),
      mockSignal("diff_edited"),
      mockSignal("diff_edited"),
    ];
    const agg = aggregateByKind(signals);
    expect(agg.diff_accepted).toBe(1);
    expect(agg.diff_edited).toBe(2);
  });
});

describe("preference dataset", () => {
  it("only edited signals qualify for preference pairs", () => {
    expect(isUsableForPreference(mockSignal("diff_accepted"))).toBe(false);
    expect(
      isUsableForPreference(
        mockSignal("diff_edited", { after: "the same long text here" }),
      ),
    ).toBe(true);
  });

  it("builds dataset only from valid signals", () => {
    const store = makePrefStore();
    const signals: FeedbackSignal[] = [
      mockSignal("diff_edited", {
        before: "agent original text",
        after: "totally different and meaningfully longer human-edited content for testing",
      }),
      mockSignal("diff_accepted"),
      mockSignal("diff_rejected"),
    ];
    const result = buildDatasetFromSignals(store, signals);
    expect(result.built).toBe(1);
    expect(result.rejected).toBe(2);
  });
});

describe("curator", () => {
  it("drops whitespace-only differences", () => {
    const pair: PreferencePair = {
      id: "p1",
      prompt: "x",
      chosen: "abc 123",
      rejected: "abc   123",
      category: null,
      qualityScore: 0.9,
      signalId: "s1",
      createdAt: 0,
    };
    const result = curatePairs([pair]);
    expect(result.kept).toHaveLength(0);
    expect(result.droppedFormatting).toBe(1);
  });

  it("drops below quality floor", () => {
    const pair: PreferencePair = {
      id: "p1",
      prompt: "x",
      chosen: "alpha beta gamma delta epsilon",
      rejected: "completely different stuff entirely",
      category: null,
      qualityScore: 0.1,
      signalId: "s1",
      createdAt: 0,
    };
    const result = curatePairs([pair]);
    expect(result.droppedLowQuality).toBe(1);
  });

  it("normalizedEditDistance returns 0 for identical, > 0 for different", () => {
    expect(normalizedEditDistance("a b c", "a b c")).toBe(0);
    expect(normalizedEditDistance("a b c", "d e f")).toBeGreaterThan(0.9);
  });

  it("caps per category", () => {
    const pairs: PreferencePair[] = Array.from({ length: 10 }).map((_, i) => ({
      id: `p${i}`,
      prompt: `prompt ${i}`,
      chosen: `chosen ${i} unique tokens for variety here`,
      rejected: `rejected ${i} different tokens here entirely`,
      category: "naming",
      qualityScore: 0.7,
      signalId: `s${i}`,
      createdAt: 0,
    }));
    const result = curatePairs(pairs, {
      minEditDistance: 0,
      perCategoryCap: 3,
      minQuality: 0.4,
    });
    expect(result.kept).toHaveLength(3);
  });
});

function mockSignal(
  kind: FeedbackSignal["kind"],
  overrides: Partial<FeedbackSignal> = {},
): FeedbackSignal {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    workspaceId: "w",
    runId: "r",
    taskNodeId: null,
    kind,
    before: "agent generated text that is some length",
    after: kind === "diff_edited" ? "human edited text that is also some length" : null,
    reason: null,
    filePath: null,
    createdAt: 0,
    ...overrides,
  };
}
