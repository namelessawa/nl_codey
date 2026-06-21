/**
 * Generate a single NL_Codey skill from a natural-language description and
 * install it under one or more skill roots (project / global / both).
 *
 * Why this lives in `lib/` and not `tui/`: the generation step is just a
 * one-shot `llm.complete()` call plus filesystem writes — there is no
 * Ink, no React, no interactivity. The TUI's modal picker drives the
 * UI; the actual work happens here so a future `nlc skills-generate`
 * subcommand can reuse the same code without spinning the Ink runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@nlc/agent-core";
import { createLLMProvider, createLLMProviderFromEnv } from "@nlc/llm";
import { cliLlmConfig, loadCliSettings } from "./settings.js";

export type SkillInstallLocation = "project" | "global" | "both";

export type GeneratedSkill = {
  /** Slug used as the filename (`<name>.md`). Validated kebab-case. */
  name: string;
  /** Catalogue line for `/skills` and the agent's prompt. */
  description: string;
  /** Raw markdown including the YAML frontmatter block. */
  content: string;
};

export type InstallResult = {
  written: string[];
  skipped: string[];
};

/** Hit the LLM and return a validated skill blob. Throws on bad output. */
export async function generateSkill(
  description: string,
  dataRoot: string,
  options: { signal?: AbortSignal } = {},
): Promise<GeneratedSkill> {
  const trimmed = description.trim();
  if (!trimmed) {
    throw new Error("/skills-generate: description is empty.");
  }
  if (trimmed.length < 8) {
    throw new Error(
      `/skills-generate: description "${trimmed}" is too short to author a skill from. ` +
        "give a sentence or two, e.g. `/skills-generate audit logs for 5xx errors`.",
    );
  }

  const settings = loadCliSettings(dataRoot);
  const config = cliLlmConfig(settings);

  // Without an API key, `createLLMProviderFromEnv` falls back to the mock
  // provider, which can't author valid skill markdown — the user would
  // get an opaque "missing name field in frontmatter" downstream. Detect
  // that case here and tell them clearly how to fix it.
  if (!config.apiKey) {
    const envProvider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
    if (envProvider === "" || envProvider === "mock") {
      throw new Error(
        "no API key configured. /skills-generate needs a real LLM.\n" +
          "  fix: export one of NLC_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, " +
          "DEEPSEEK_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY\n" +
          "  or:  configure a key via the GUI settings panel (the GUI encrypts " +
          "the key into ~/.nlc/apikey.bin, which the CLI can't decrypt — only " +
          "env vars work here).",
      );
    }
  }

  const llm = config.apiKey
    ? createLLMProvider(config)
    : createLLMProviderFromEnv(process.env);

  const out = await llm.complete({
    messages: [
      { role: "system", content: SKILL_GENERATOR_PROMPT },
      { role: "user", content: trimmed },
    ],
    temperature: 0.3,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const raw = stripCodeFence(out.text.trim());
  const { frontmatter } = parseFrontmatter(raw);

  const name = (frontmatter.name ?? "").trim();
  const fmDesc = (frontmatter.description ?? "").trim();

  if (!name) {
    throw new Error(
      "LLM output is missing a `name` field in frontmatter. First 400 chars:\n" +
        raw.slice(0, 400),
    );
  }
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Expected kebab-case, 2-30 chars, ASCII letters/digits/hyphens.`,
    );
  }
  if (!fmDesc) {
    throw new Error("LLM output is missing a `description` field in frontmatter.");
  }
  return { name, description: fmDesc, content: raw };
}

/** Write the skill file into one or more skill roots. */
export function installSkill(
  skill: GeneratedSkill,
  location: SkillInstallLocation,
  workspaceRoot: string,
  dataRoot: string,
  options: { overwrite?: boolean } = {},
): InstallResult {
  const overwrite = options.overwrite === true;
  const written: string[] = [];
  const skipped: string[] = [];

  const writeOne = (dir: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${skill.name}.md`);
    if (!overwrite && fs.existsSync(target)) {
      skipped.push(target);
      return;
    }
    fs.writeFileSync(target, skill.content, "utf8");
    written.push(target);
  };

  if (location === "project" || location === "both") {
    writeOne(path.join(workspaceRoot, ".nlc", "skills"));
  }
  if (location === "global" || location === "both") {
    writeOne(path.join(dataRoot, "skills"));
  }
  return { written, skipped };
}

/** Pretty-print the install outcome for the TUI's system-message stream. */
export function renderInstallOutcome(
  skill: GeneratedSkill,
  result: InstallResult,
  location: SkillInstallLocation,
): string {
  const lines: string[] = [
    `generated skill "${skill.name}" (${location})`,
    `  ${skill.description}`,
  ];
  if (result.written.length > 0) {
    lines.push("", "wrote:");
    for (const p of result.written) lines.push(`  + ${p}`);
  }
  if (result.skipped.length > 0) {
    lines.push("", "skipped (already existed):");
    for (const p of result.skipped) lines.push(`  · ${p}`);
  }
  lines.push("", "agent loop will pick this up on the next task — try /skills to confirm.");
  return lines.join("\n");
}

// --- internals --------------------------------------------------------

/** Some models wrap markdown in ```markdown … ``` fences. Strip those. */
function stripCodeFence(text: string): string {
  const m = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (m && m[1]) return m[1].trim();
  return text;
}

const SKILL_GENERATOR_PROMPT = `You are a NL_Codey skill author. The user will describe a workflow they want as a reusable "skill" — a markdown file with YAML frontmatter that NL_Codey loads into its agent prompt.

Generate ONE skill file. Output ONLY the raw markdown content. Do not wrap in code fences. Do not add commentary before or after.

Required frontmatter (between \`---\` fences at the very top):
- name: kebab-case identifier (lowercase letters, digits, hyphens only; 2-30 chars). Describe the skill in 1-3 words.
- description: one short sentence telling the agent what this skill does. Max 100 chars.
- when_to_use: one sentence telling the agent when to invoke this skill. Max 100 chars.

After the closing \`---\`, write the skill body in markdown:
- Start with a level-1 or level-2 heading naming the skill.
- List concrete, actionable steps the agent should follow.
- Be specific: name concrete tools, file paths, commands when relevant.
- Keep the body under 50 lines.
- Prefer numbered steps and bullet lists. Avoid long prose paragraphs.

Output format example (the user is asking for something different; do NOT echo this example):

---
name: log-audit
description: Audit a service's logs for unexpected errors and propose follow-up actions.
when_to_use: when the user says "check the logs" or pastes a log excerpt.
---

# Log audit

1. Identify the log source (file path, service name, or pasted excerpt).
2. Search for keywords: "ERROR", "FATAL", "panic", "exception", "5xx".
3. Group by error type, count occurrences, note first/last timestamps.
4. For each unique error, suggest one concrete next step.
5. End with a "Top 3 issues" summary.
`;
