import {
  type PRDescription,
  type PRDescriptionInput,
  type TaskChangeSummary,
  PR_DESCRIPTION_MAX_CHARS,
} from "@nlc/shared";

/** Marker appended when the body is truncated to the hard cap. */
const TRUNCATION_MARKER = "\n\n_…description truncated…_";

type RiskLevel = "low" | "medium" | "high";
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * Build a Markdown PR description from the per-task summaries. Pure function:
 * no git, no I/O. The body is capped at PR_DESCRIPTION_MAX_CHARS with a
 * truncation marker so it never overflows downstream PR limits.
 */
export function buildPRDescription(input: PRDescriptionInput): PRDescription {
  const title = buildTitle(input.userRequest);
  const sections = [
    buildOriginalRequest(input.userRequest),
    buildTaskOverview(input.tasks),
    buildPerTaskChanges(input.tasks),
    buildTestResults(input),
    buildRiskNote(input.tasks),
    buildManualVerify(input.tasks),
  ];

  const body = truncateBody(sections.join("\n\n"));
  return { title, body };
}

function buildTitle(userRequest: string): string {
  const firstLine = userRequest.split("\n")[0]?.trim() ?? "";
  const summary = firstLine || "automated changes";
  return `Agent: ${summary}`;
}

function buildOriginalRequest(userRequest: string): string {
  return `## Original request\n\n${userRequest.trim() || "_(none provided)_"}`;
}

function buildTaskOverview(tasks: TaskChangeSummary[]): string {
  if (tasks.length === 0) {
    return "## Task overview\n\n_No tasks recorded._";
  }
  const list = tasks.map((task) => `- ${task.title}`).join("\n");
  return `## Task overview\n\n${list}`;
}

function buildPerTaskChanges(tasks: TaskChangeSummary[]): string {
  if (tasks.length === 0) {
    return "## Changes by task\n\n_No changes recorded._";
  }
  const blocks = tasks.map((task) => {
    const files =
      task.changedFiles.length > 0
        ? task.changedFiles.map((file) => `- \`${file}\``).join("\n")
        : "- _(no files changed)_";
    return `### ${task.title}\n\n${files}`;
  });
  return `## Changes by task\n\n${blocks.join("\n\n")}`;
}

function buildTestResults(input: PRDescriptionInput): string {
  const perTask = input.tasks
    .filter((task) => task.testResult && task.testResult.trim())
    .map((task) => `- **${task.title}**: ${task.testResult?.trim()}`);

  const lines: string[] = [];
  if (input.testOutput && input.testOutput.trim()) {
    lines.push("```\n" + input.testOutput.trim() + "\n```");
  }
  if (perTask.length > 0) {
    lines.push(perTask.join("\n"));
  }
  const content = lines.length > 0 ? lines.join("\n\n") : "_No test results recorded._";
  return `## Test results\n\n${content}`;
}

function buildRiskNote(tasks: TaskChangeSummary[]): string {
  const highest = aggregateRisk(tasks);
  return `## Regression risk\n\nHighest assessed risk across tasks: **${highest}**.`;
}

/** Aggregate per-task regression risk; the highest level wins. */
export function aggregateRisk(tasks: TaskChangeSummary[]): RiskLevel {
  let highest: RiskLevel = "low";
  for (const task of tasks) {
    const risk = task.regressionRisk ?? "low";
    if (RISK_ORDER[risk] > RISK_ORDER[highest]) highest = risk;
  }
  return highest;
}

function buildManualVerify(tasks: TaskChangeSummary[]): string {
  const files = new Set<string>();
  for (const task of tasks) {
    for (const file of task.changedFiles) files.add(file);
  }
  const steps = [
    "1. Check out this branch.",
    "2. Install dependencies and run the project's test suite.",
  ];
  if (files.size > 0) {
    const list = [...files].map((file) => `   - \`${file}\``).join("\n");
    steps.push(`3. Review the changed files:\n${list}`);
  }
  steps.push(`${files.size > 0 ? 4 : 3}. Exercise the affected behavior manually.`);
  return `## How to manually verify\n\n${steps.join("\n")}`;
}

function truncateBody(body: string): string {
  if (body.length <= PR_DESCRIPTION_MAX_CHARS) return body;
  const budget = PR_DESCRIPTION_MAX_CHARS - TRUNCATION_MARKER.length;
  const safeBudget = budget > 0 ? budget : 0;
  return body.slice(0, safeBudget) + TRUNCATION_MARKER;
}
