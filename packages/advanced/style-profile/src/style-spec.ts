/**
 * StyleSpec port + factory. The style profile lives at three scopes:
 * `global` (user-level), `team` (shared trust boundary), `project` (per-workspace).
 * Each scope is one row. The Coder system prompt injects rules sorted by
 * strength (must > should > prefer), with confidence as a tie-breaker.
 *
 * Style is ALWAYS subordinate to correctness — style never overrides "make
 * the build green". The system prompt makes this explicit.
 */
import { randomUUID } from "node:crypto";
import type {
  StyleCategory,
  StyleRule,
  StyleRulePatch,
  StyleScope,
  StyleSpec,
  StyleStrength,
} from "@nlc/shared";

export interface StyleStore {
  upsertStyleSpec(spec: StyleSpec): StyleSpec;
  getStyleSpec(scope: StyleScope, workspaceId: string | null): StyleSpec | null;
}

export function makeEmptySpec(
  scope: StyleScope,
  workspaceId: string | null,
): StyleSpec {
  return {
    scope,
    workspaceId,
    rules: [],
    derivedFrom: { codebaseStats: {}, acceptedDiffs: 0, rejectedDiffs: 0 },
    version: 1,
    updatedAt: Date.now(),
  };
}

export function makeRule(
  category: StyleCategory,
  rule: string,
  strength: StyleStrength = "should",
  source: StyleRule["source"] = "manual",
): StyleRule {
  const now = Date.now();
  return {
    id: randomUUID(),
    category,
    rule,
    examples: [],
    strength,
    confidence: 0.5,
    signalCount: 0,
    source,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateRule(rule: StyleRule, patch: StyleRulePatch): StyleRule {
  return { ...rule, ...patch, id: rule.id, createdAt: rule.createdAt, updatedAt: Date.now() };
}

export function addRule(spec: StyleSpec, rule: StyleRule): StyleSpec {
  return { ...spec, rules: [...spec.rules, rule], updatedAt: Date.now() };
}

export function removeRule(spec: StyleSpec, ruleId: string): StyleSpec {
  return { ...spec, rules: spec.rules.filter((r) => r.id !== ruleId), updatedAt: Date.now() };
}

export function replaceRule(spec: StyleSpec, rule: StyleRule): StyleSpec {
  return {
    ...spec,
    rules: spec.rules.map((r) => (r.id === rule.id ? rule : r)),
    updatedAt: Date.now(),
  };
}

/** Sort rules by strength priority then confidence, suitable for prompt injection. */
const STRENGTH_ORDER: Record<StyleStrength, number> = { must: 0, should: 1, prefer: 2 };

export function sortedRulesForPrompt(spec: StyleSpec): StyleRule[] {
  return [...spec.rules].sort((a, b) => {
    const s = STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength];
    if (s !== 0) return s;
    return b.confidence - a.confidence;
  });
}

/** Render the StyleSpec into a Markdown block for the Coder system prompt. */
export function renderStyleBlock(spec: StyleSpec): string {
  const sorted = sortedRulesForPrompt(spec);
  if (sorted.length === 0) return "";
  const lines: string[] = [];
  lines.push("## 编码风格规范(来自项目历史与你的反馈)");
  lines.push('以下规则按强度排序。**风格让步于正确性 —— 若与"代码能跑"冲突,以正确性为先。**');
  lines.push("");
  for (const rule of sorted) {
    const tag = rule.strength.toUpperCase();
    lines.push(`- [${tag}] (${rule.category}) ${rule.rule}`);
  }
  return lines.join("\n");
}
