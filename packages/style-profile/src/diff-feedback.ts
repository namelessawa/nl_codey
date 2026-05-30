/**
 * Learn style rules from diff feedback. When the user repeatedly rejects or
 * edits the same kind of agent change (e.g. always converts `try/catch` to
 * `Result`), this module promotes that into a new (or strengthens an existing)
 * `should`-level rule.
 *
 * Trigger threshold: 3 consistent signals in the same category. This avoids
 * flapping from one-off user edits, while still being responsive.
 */
import type {
  FeedbackSignal,
  StyleCategory,
  StyleRule,
  StyleSpec,
  StyleStrength,
} from "@coding-agent/shared";
import { addRule, makeRule, replaceRule } from "./style-spec.js";

export const PROMOTE_THRESHOLD = 3;
export const STRENGTHEN_THRESHOLD = 6;

// Cap diff text length before any regex test. Diffs are LLM/user-controlled
// input and would otherwise let an attacker amplify polynomial-time regex
// matches (ReDoS). 4 KB is well above what we need for heuristic
// classification of a code edit.
const MAX_SIGNAL_LEN = 4000;

export type SignalSummary = {
  category: StyleCategory;
  description: string;
  example: { good: string; bad: string };
  signalCount: number;
};

/** Classify a single signal into a (category, summary) tuple. */
export function classifySignal(signal: FeedbackSignal): SignalSummary | null {
  if (signal.kind === "diff_accepted") return null;
  if (!signal.before) return null;

  const before = signal.before.slice(0, MAX_SIGNAL_LEN);
  const after = (signal.after ?? "").slice(0, MAX_SIGNAL_LEN);

  // Split try/catch detection into two anchored sub-regexes instead of one
  // `try\s*\{[\s\S]*?\}\s*catch` — the lazy `[\s\S]*?` makes the original
  // worst-case polynomial on inputs like `try{try{try{...`.
  if (
    /try\s*\{/.test(before) &&
    /\}\s*catch\b/.test(before) &&
    /Result[<(]/.test(after)
  ) {
    return {
      category: "error-handling",
      description: "用 Result<T,E> 替代 try/catch 处理可预期失败",
      example: { good: after.slice(0, 200), bad: before.slice(0, 200) },
      signalCount: 1,
    };
  }
  if (/console\.log/.test(before) && !/console\.log/.test(after)) {
    return {
      category: "comments",
      description: "提交前不要保留 console.log",
      example: { good: after.slice(0, 200), bad: before.slice(0, 200) },
      signalCount: 1,
    };
  }
  if (/\bvar\s+/.test(before) && !/\bvar\s+/.test(after)) {
    return {
      category: "structure",
      description: "使用 const/let,禁止 var",
      example: { good: after.slice(0, 200), bad: before.slice(0, 200) },
      signalCount: 1,
    };
  }
  if (/\bany\b/.test(before) && !/\bany\b/.test(after)) {
    return {
      category: "structure",
      description: "避免 any 类型;首选 unknown 并显式收窄",
      example: { good: after.slice(0, 200), bad: before.slice(0, 200) },
      signalCount: 1,
    };
  }
  // Naming: snake_case → camelCase preference detection. Original
  // `[a-z]+_[a-z]+` was polynomial on long `a`-runs without `_`; a single-char
  // match on either side is sufficient to detect the pattern.
  if (/[a-z]_[a-z]/.test(before) && !/[a-z]_[a-z]/.test(after)) {
    return {
      category: "naming",
      description: "TypeScript 标识符使用 camelCase,避免 snake_case",
      example: { good: after.slice(0, 200), bad: before.slice(0, 200) },
      signalCount: 1,
    };
  }
  return null;
}

/** Aggregate signals into per-rule summaries. */
export function summarizeSignals(signals: FeedbackSignal[]): SignalSummary[] {
  const aggregate = new Map<string, SignalSummary>();
  for (const s of signals) {
    const classified = classifySignal(s);
    if (!classified) continue;
    const key = `${classified.category}::${classified.description}`;
    const existing = aggregate.get(key);
    if (existing) {
      existing.signalCount++;
    } else {
      aggregate.set(key, { ...classified });
    }
  }
  return Array.from(aggregate.values());
}

export type LearnResult = {
  spec: StyleSpec;
  added: StyleRule[];
  strengthened: StyleRule[];
};

/** Apply summaries to a spec; create new rules or strengthen existing ones. */
export function applySummariesToSpec(
  spec: StyleSpec,
  summaries: SignalSummary[],
): LearnResult {
  let next = spec;
  const added: StyleRule[] = [];
  const strengthened: StyleRule[] = [];

  for (const summary of summaries) {
    const existing = next.rules.find(
      (r) => r.category === summary.category && r.rule === summary.description,
    );
    if (existing) {
      const newCount = existing.signalCount + summary.signalCount;
      const newStrength: StyleStrength = pickStrength(existing.strength, newCount);
      const updated: StyleRule = {
        ...existing,
        signalCount: newCount,
        strength: newStrength,
        confidence: Math.min(1, existing.confidence + 0.1 * summary.signalCount),
        examples: mergeExamples(existing.examples, summary.example),
        updatedAt: Date.now(),
      };
      next = replaceRule(next, updated);
      strengthened.push(updated);
    } else if (summary.signalCount >= PROMOTE_THRESHOLD) {
      const rule = makeRule(summary.category, summary.description, "should", "feedback");
      const enriched: StyleRule = {
        ...rule,
        signalCount: summary.signalCount,
        examples: [summary.example],
        confidence: 0.5 + 0.05 * summary.signalCount,
      };
      next = addRule(next, enriched);
      added.push(enriched);
    }
  }
  return { spec: next, added, strengthened };
}

function pickStrength(current: StyleStrength, count: number): StyleStrength {
  if (current === "must") return "must";
  if (count >= STRENGTHEN_THRESHOLD) return "must";
  if (count >= PROMOTE_THRESHOLD) return "should";
  return current;
}

function mergeExamples(
  existing: StyleRule["examples"],
  next: StyleRule["examples"][number],
): StyleRule["examples"] {
  if (existing.length >= 3) return existing;
  return [...existing, next];
}
