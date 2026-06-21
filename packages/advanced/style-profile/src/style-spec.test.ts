import { describe, expect, it } from "vitest";
import { computeCodebaseStats, extractStyleSpec } from "./style-extractor.js";
import {
  applySummariesToSpec,
  classifySignal,
  PROMOTE_THRESHOLD,
  STRENGTHEN_THRESHOLD,
  summarizeSignals,
} from "./diff-feedback.js";
import { addRule, makeEmptySpec, makeRule, renderStyleBlock, sortedRulesForPrompt } from "./style-spec.js";
import type { FeedbackSignal, StyleRule } from "@nlc/shared";

describe("style-extractor", () => {
  it("detects double quotes and tab indent", () => {
    const stats = computeCodebaseStats([
      { path: "a.ts", content: '"hello"\n"world"\nconst x = "yes";\n' },
      { path: "b.ts", content: 'const y = "abc";\n' },
    ]);
    expect(stats.quotePreference).toBe("double");
  });

  it("derived spec contains semicolon and quote rules", () => {
    const spec = extractStyleSpec(
      [{ path: "a.ts", content: 'const x = "hi";\nfunction f() { return 1; }\n' }],
      { scope: "project", workspaceId: "ws-1" },
    );
    expect(spec.rules.length).toBeGreaterThanOrEqual(2);
    expect(spec.scope).toBe("project");
    expect(spec.workspaceId).toBe("ws-1");
  });
});

describe("diff-feedback classifier", () => {
  it("detects try/catch → Result conversion", () => {
    const signal: FeedbackSignal = {
      id: "s1",
      workspaceId: "w",
      runId: "r",
      taskNodeId: null,
      kind: "diff_edited",
      before: "try {\n  doIt()\n} catch (e) {\n  log(e)\n}",
      after: "const result: Result<void, Error> = tryDo();",
      reason: null,
      filePath: null,
      createdAt: 0,
    };
    expect(classifySignal(signal)?.category).toBe("error-handling");
  });

  it("ignores diff_accepted signals", () => {
    const signal: FeedbackSignal = {
      id: "s2",
      workspaceId: "w",
      runId: "r",
      taskNodeId: null,
      kind: "diff_accepted",
      before: "any code",
      after: null,
      reason: null,
      filePath: null,
      createdAt: 0,
    };
    expect(classifySignal(signal)).toBeNull();
  });
});

describe("applySummariesToSpec", () => {
  it("promotes new rule when threshold reached", () => {
    const spec = makeEmptySpec("project", "w-1");
    const signals: FeedbackSignal[] = Array.from({ length: PROMOTE_THRESHOLD }).map((_, i) => ({
      id: `s${i}`,
      workspaceId: "w",
      runId: "r",
      taskNodeId: null,
      kind: "diff_edited" as const,
      before: "try { doIt() } catch (e) { log(e) }",
      after: "Result<void, Error>",
      reason: null,
      filePath: null,
      createdAt: 0,
    }));
    const summaries = summarizeSignals(signals);
    const result = applySummariesToSpec(spec, summaries);
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.category).toBe("error-handling");
  });

  it("strengthens existing rule when signal count reaches must threshold", () => {
    let spec = makeEmptySpec("project", null);
    const rule: StyleRule = {
      ...makeRule("error-handling", "用 Result<T,E> 替代 try/catch 处理可预期失败", "should", "feedback"),
      signalCount: STRENGTHEN_THRESHOLD - 1,
    };
    spec = addRule(spec, rule);
    const signals: FeedbackSignal[] = [
      {
        id: "s1",
        workspaceId: "w",
        runId: "r",
        taskNodeId: null,
        kind: "diff_edited",
        before: "try { doIt() } catch (e) { log(e) }",
        after: "Result<void, Error>",
        reason: null,
        filePath: null,
        createdAt: 0,
      },
    ];
    const summaries = summarizeSignals(signals);
    const result = applySummariesToSpec(spec, summaries);
    expect(result.strengthened[0]?.strength).toBe("must");
  });

  it("does NOT promote below threshold", () => {
    const spec = makeEmptySpec("project", null);
    const fewSignals: FeedbackSignal[] = [
      {
        id: "s1",
        workspaceId: "w",
        runId: "r",
        taskNodeId: null,
        kind: "diff_edited",
        before: "try { x() } catch (e) {}",
        after: "Result<void, Error>",
        reason: null,
        filePath: null,
        createdAt: 0,
      },
    ];
    const summaries = summarizeSignals(fewSignals);
    const result = applySummariesToSpec(spec, summaries);
    expect(result.added).toHaveLength(0);
  });
});

describe("renderStyleBlock", () => {
  it("renders must rules first, includes correctness disclaimer", () => {
    let spec = makeEmptySpec("project", null);
    spec = addRule(spec, makeRule("naming", "use camelCase", "should"));
    spec = addRule(spec, makeRule("error-handling", "no try/catch sink", "must"));
    const block = renderStyleBlock(spec);
    expect(block).toContain("正确性");
    const sorted = sortedRulesForPrompt(spec);
    expect(sorted[0]?.strength).toBe("must");
  });
});
