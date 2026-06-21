/**
 * Phase 1 — initContext.
 *
 * Stacks the system prompt out of the project's own resources (no SDK):
 *
 *   1. Built-in NL_Codey base prompt (from prompts.ts, language-aware).
 *   2. Global override   — ~/.nlc/system.md
 *   3. Project override  — <ws>/.nlc/system.md
 *   4. Global agents     — ~/.nlc/agents.md
 *   5. Project agents    — <ws>/.nlc/AGENTS.md  (or <ws>/.nlc/agents.md)
 *   6. Skills catalogue  — every *.md in ~/.nlc/skills and <ws>/.nlc/skills
 *
 * Sections are joined with a `\n\n---\n\n` separator so the model sees clear
 * boundaries. Later sections override earlier ones because LLMs tend to
 * weigh closer instructions more heavily — the project's AGENTS.md should
 * trump generic global guidance.
 *
 * The tool catalogue is NOT in the system message: tools travel via the
 * tool-calling API (`tools` parameter), which is the project's existing
 * convention (see prompts.ts: "Tools are injected via the tool-calling API,
 * so they are described there, not re-listed here.").
 *
 * Prior history is appended verbatim minus any stale `system` messages —
 * Phase 1 always re-derives the system stack from the current on-disk
 * state, so editing system.md / agents.md / skills.md takes effect on the
 * next turn without restart.
 */
import path from "node:path";
import { nlcRoot, type LLMMessage } from "@nlc/shared";
import { getSystemPrompt } from "../prompts.js";
import {
  loadSkills,
  readMdIfExists,
  readProjectAgents,
  renderSkillsCatalogue,
} from "./loader.js";
import type {
  ContextInputs,
  NlcLoopDeps,
  NlcLoopInput,
  Phase1Options,
  Phase1Result,
} from "./types.js";

const SECTION_SEPARATOR = "\n\n---\n\n";

/**
 * Run Phase 1: produce the system+history+user message stack and the input
 * snapshot. Accepts either a {@link NlcLoopDeps} (full loop wiring) or the
 * lighter {@link Phase1Options} subset — the GUI calls it with the lighter
 * subset because it has no LLM to spin for Phase 1 alone.
 */
export async function phase1InitContext(
  input: NlcLoopInput,
  depsOrOptions: NlcLoopDeps | Phase1Options = {},
): Promise<Phase1Result> {
  const options: Phase1Options = isNlcLoopDeps(depsOrOptions)
    ? depsOrOptions.options ?? {}
    : depsOrOptions;
  const lang = options.language ?? "zh-CN";
  const globalRoot = options.globalRoot ?? nlcRoot();

  // customBuiltinPrompt overrides the zh/en base — used by read-only mode
  // to substitute getReadonlySystemPrompt without coupling Phase 1 to
  // prompts.ts's full surface.
  const builtin = options.customBuiltinPrompt ?? getSystemPrompt(lang);
  const globalSystem = readMdIfExists(path.join(globalRoot, "system.md"));
  const projectSystem = readMdIfExists(
    path.join(input.workspaceRoot, ".nlc", "system.md"),
  );
  const globalAgents = readMdIfExists(path.join(globalRoot, "agents.md"));
  const projectAgents = readProjectAgents(input.workspaceRoot);

  const globalSkills = loadSkills(path.join(globalRoot, "skills"), "global");
  const projectSkills = loadSkills(
    path.join(input.workspaceRoot, ".nlc", "skills"),
    "project",
  );
  // Project skills replace any global skill with the same name — local
  // wins, matching the spirit of system.md/agents.md ordering.
  const skills = mergeSkillsLocalWins(globalSkills, projectSkills);

  const augmentation = options.augmentation?.trim() ?? "";

  const inputs: ContextInputs = {
    builtin,
    globalSystem,
    projectSystem,
    globalAgents,
    projectAgents,
    skills,
    augmentation,
  };

  const systemContent = composeSystemMessage(inputs);
  const systemMessage: LLMMessage = { role: "system", content: systemContent };

  const cleanHistory = (input.history ?? []).filter((m) => m.role !== "system");
  const currentTurn: LLMMessage = { role: "user", content: input.currentMessage };

  return {
    messages: [systemMessage, ...cleanHistory, currentTurn],
    inputs,
  };
}

/**
 * Stitch the system message together. Public so tests and the UI can
 * preview exactly what the model will see without spinning a real LLM.
 */
export function composeSystemMessage(inputs: ContextInputs): string {
  const sections: string[] = [inputs.builtin];
  if (inputs.globalSystem) sections.push(inputs.globalSystem);
  if (inputs.projectSystem) sections.push(inputs.projectSystem);
  if (inputs.globalAgents) sections.push(`# Global agents\n\n${inputs.globalAgents}`);
  if (inputs.projectAgents) sections.push(`# Project agents\n\n${inputs.projectAgents}`);
  const catalogue = renderSkillsCatalogue(inputs.skills);
  if (catalogue) sections.push(catalogue);
  // Augmentation last — Phase 4 hook expects to override or supplement
  // everything above.
  if (inputs.augmentation) sections.push(inputs.augmentation);
  return sections.join(SECTION_SEPARATOR);
}

function mergeSkillsLocalWins<T extends { name: string }>(globals: T[], locals: T[]): T[] {
  const localNames = new Set(locals.map((s) => s.name));
  const filteredGlobals = globals.filter((s) => !localNames.has(s.name));
  return [...filteredGlobals, ...locals].sort((a, b) => a.name.localeCompare(b.name));
}

/** Discriminator for the overloaded {@link phase1InitContext} signature. */
function isNlcLoopDeps(value: NlcLoopDeps | Phase1Options): value is NlcLoopDeps {
  return typeof (value as NlcLoopDeps).llm === "object" &&
    (value as NlcLoopDeps).llm !== null &&
    typeof (value as NlcLoopDeps).executeTool === "function";
}
