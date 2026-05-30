/**
 * Retrieves relevant GlobalPatterns for injection into a task's system prompt.
 * Constraints:
 *  - ≤ 3 patterns per task to avoid context bloat.
 *  - Every returned pattern includes its provenance (source projects).
 *  - Caller decides whether to inject; this module only ranks.
 */
import type { GlobalPattern } from "@coding-agent/shared";

export type RetrievalContext = {
  taskText: string;
  /** Optional pre-computed query embedding. */
  queryEmbedding?: number[];
  /** Tags the task has been pre-classified with (e.g. by /plan). */
  taskTags?: string[];
};

export type RetrievalCandidate = { pattern: GlobalPattern; embedding: number[] };

export type RetrievedPattern = {
  pattern: GlobalPattern;
  score: number;
  reasons: string[];
};

export const MAX_INJECTED_PATTERNS = 3;

export function retrieveRelevantPatterns(
  candidates: RetrievalCandidate[],
  ctx: RetrievalContext,
  limit = MAX_INJECTED_PATTERNS,
): RetrievedPattern[] {
  const taskLower = ctx.taskText.toLowerCase();
  const taskTags = new Set((ctx.taskTags ?? []).map((t) => t.toLowerCase()));

  const scored: RetrievedPattern[] = candidates.map(({ pattern, embedding }) => {
    const reasons: string[] = [];
    let score = pattern.confidence * 0.4;
    if (pattern.title && taskLower.includes(pattern.title.toLowerCase().slice(0, 16))) {
      score += 0.2;
      reasons.push("title overlap with task");
    }
    let tagMatches = 0;
    for (const tag of pattern.tags) {
      if (taskTags.has(tag.toLowerCase())) tagMatches++;
    }
    if (tagMatches > 0) {
      score += Math.min(0.3, tagMatches * 0.15);
      reasons.push(`${tagMatches} tag(s) matched`);
    }
    if (ctx.queryEmbedding && embedding.length === ctx.queryEmbedding.length) {
      const sim = cosineSimilarity(ctx.queryEmbedding, embedding);
      score += sim * 0.4;
      if (sim > 0.5) reasons.push(`semantic sim ${sim.toFixed(2)}`);
    }
    if (pattern.sourceProjects.length >= 3) {
      score += 0.05;
      reasons.push(`${pattern.sourceProjects.length} corroborating projects`);
    }
    return { pattern, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).filter((r) => r.score > 0.15);
}

/** Render retrieved patterns as a provenance-tagged Markdown block. */
export function renderProvenanceBlock(retrieved: RetrievedPattern[]): string {
  if (retrieved.length === 0) return "";
  const lines: string[] = [];
  lines.push("## 跨项目可复用模式(参考,非强制)");
  retrieved.forEach((r, idx) => {
    const projects = r.pattern.sourceProjects.length;
    const conf = r.pattern.confidence.toFixed(2);
    lines.push(
      `${idx + 1}. ${r.pattern.title}(来自 ${projects} 个项目,置信度 ${conf})`,
    );
    if (r.pattern.description) {
      lines.push(`   - ${r.pattern.description.slice(0, 200)}`);
    }
  });
  lines.push("");
  lines.push("以上模式仅供参考,不强制采纳。若与当前任务不符,优先遵守本项目风格与正确性。");
  return lines.join("\n");
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
