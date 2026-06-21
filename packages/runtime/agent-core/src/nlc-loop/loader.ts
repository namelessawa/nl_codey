/**
 * Filesystem loaders for the NLC loop's Phase 1 context. Everything in here
 * is best-effort: a missing file is a `null`, an unreadable file is a `null`.
 * Phase 1 must never reject because of a malformed `system.md` — the model
 * should still be able to run on the built-in base prompt.
 *
 * No third-party dependencies — we hand-parse the small frontmatter subset
 * we actually use (key: value lines, no nested YAML).
 */
import fs from "node:fs";
import path from "node:path";
import type { SkillDescriptor } from "./types.js";

/** Read a UTF-8 markdown file, or null when missing/unreadable. */
export function readMdIfExists(absPath: string): string | null {
  try {
    if (!fs.existsSync(absPath)) return null;
    const text = fs.readFileSync(absPath, "utf8");
    return stripBom(text).trim().length > 0 ? stripBom(text) : null;
  } catch {
    return null;
  }
}

/**
 * Locate the project-level agents description. We accept the upper-case
 * convention many repos already use (`AGENTS.md` at the workspace root)
 * AND the dot-namespaced `<ws>/.nlc/agents.md` so a user can keep
 * NL_Codey-only guidance separate from the shared file.
 *
 * Preference: `.nlc/agents.md` first (NL-Codey-specific), then `AGENTS.md`
 * (project-wide). Returns `null` when neither exists.
 */
export function readProjectAgents(workspaceRoot: string): string | null {
  return (
    readMdIfExists(path.join(workspaceRoot, ".nlc", "agents.md")) ??
    readMdIfExists(path.join(workspaceRoot, "AGENTS.md"))
  );
}

/**
 * Load every `*.md` skill file in `dir`, parsing its frontmatter. Files
 * without a frontmatter block are still loaded — they end up with the
 * filename stem as `name` and an empty `description`, which is fine for a
 * draft skill that hasn't been catalogued yet.
 */
export function loadSkills(dir: string, source: "global" | "project"): SkillDescriptor[] {
  let entries: string[];
  try {
    if (!fs.existsSync(dir)) return [];
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const skills: SkillDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    let raw: string;
    try {
      raw = stripBom(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    const stem = entry.replace(/\.md$/i, "");
    const name = stringFrom(frontmatter.name) ?? stem;
    const description = stringFrom(frontmatter.description) ?? "";
    const whenToUse =
      stringFrom(frontmatter.when_to_use) ??
      stringFrom(frontmatter.whenToUse) ??
      stringFrom(frontmatter.trigger);
    skills.push({
      name,
      description,
      ...(whenToUse ? { whenToUse } : {}),
      source,
      filePath,
      body: body.trim(),
    });
  }
  // Sort by name so the catalogue order is stable across reloads — model
  // sees the same prompt text given the same on-disk set.
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * Render the skill catalogue as a markdown block to inject into the system
 * prompt. Only the description + trigger hint go in — bodies are loaded on
 * demand via the `invoke_skill` tool so they don't blow up Phase 2 token
 * estimates.
 */
export function renderSkillsCatalogue(skills: readonly SkillDescriptor[]): string {
  if (skills.length === 0) return "";
  const lines: string[] = ["# Available skills", ""];
  for (const s of skills) {
    lines.push(`## ${s.name} (${s.source})`);
    if (s.description) lines.push(s.description);
    if (s.whenToUse) lines.push(`When to use: ${s.whenToUse}`);
    lines.push(
      `Invoke via the \`invoke_skill\` tool with \`name=${JSON.stringify(s.name)}\` to load the full body.`,
    );
    lines.push("");
  }
  return lines.join("\n").trim();
}

// --- internals ---

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Tiny YAML-frontmatter parser. Recognises the leading `---\n…\n---\n`
 * block; inside, accepts `key: value` lines (everything after the colon is
 * trimmed). Anything richer — nested objects, multi-line scalars, lists —
 * is intentionally NOT parsed; the skill author is expected to keep the
 * frontmatter flat.
 *
 * On any malformed input the whole content is returned as body, frontmatter
 * is empty. Phase 1 then falls back to the filename stem for the name.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  // Match the closing fence on its own line.
  const closing = raw.indexOf("\n---", 3);
  if (closing < 0) return { frontmatter: {}, body: raw };
  // The closing fence may be followed by \n or EOF.
  const afterFence = closing + 4;
  const head = raw.slice(3, closing).replace(/^\r?\n/, "");
  let body = raw.slice(afterFence);
  if (body.startsWith("\r")) body = body.slice(1);
  if (body.startsWith("\n")) body = body.slice(1);
  const frontmatter: Record<string, string> = {};
  for (const line of head.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
