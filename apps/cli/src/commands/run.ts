/**
 * `nlc run "<task>"` — headless agent loop driven by the same AgentService
 * the GUI uses. Streams assistant text deltas + step events to stdout, and
 * gates `apply_patch` (and `run_command` when confirmations are on) through
 * a line-mode y/n prompt unless `--yes` was passed.
 */
import path from "node:path";
import { nlcRoot, type AgentEvent } from "@nlc/shared";
import { buildCliServices, type CliServices } from "../lib/services.js";
import { yesNo } from "../lib/prompts.js";
import { c, writeLine, writeErrLine } from "../lib/format.js";
import type { ParsedArgs } from "../lib/argv.js";

export async function runRun(args: ParsedArgs): Promise<number> {
  const task = args.positional[0];
  if (!task) {
    writeErrLine('nlc run: missing task. Usage: nlc run "fix the failing test in utils.ts"');
    return 2;
  }

  const dataRoot = (args.flags.get("data-root") ?? nlcRoot()).toString();
  const workspaceRoot = path.resolve(args.flags.get("workspace") ?? process.cwd());
  const autoApprove = args.flags.has("yes") || args.flags.has("y");
  const jsonMode = args.flags.has("json");

  // Late-binding state: AgentService runs in the background after runTask
  // returns, so the patch_ready event arrives *after* we know the runId.
  // The approval chain serialises decisions so two back-to-back patches
  // don't race the same readline prompt.
  let runId: string | null = null;
  let services: CliServices | null = null;
  let approvalChain: Promise<void> = Promise.resolve();

  const emit = (event: AgentEvent): void => {
    streamEvent(event, { jsonMode });
    if (event.kind === "patch_ready") {
      const targetRunId = runId;
      const targetServices = services;
      if (!targetRunId || !targetServices) return;
      approvalChain = approvalChain.then(async () => {
        const decision = autoApprove
          ? true
          : await yesNo(c.yellow("Apply this patch?"), false);
        try {
          if (decision) await targetServices.agent.applyPatch(targetRunId);
          else targetServices.agent.rejectPatch(targetRunId);
        } catch (err) {
          writeErrLine(`approval handoff failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }
  };

  services = buildCliServices({ dataRoot, emit });
  const workspace = services.storage.upsertWorkspace(workspaceRoot);

  if (!jsonMode) {
    writeLine(c.gray(`workspace ${workspaceRoot}`));
    writeLine(c.gray(`data root ${dataRoot}`));
    writeLine("");
  }

  try {
    const detail = await services.agent.runTask(workspace.id, task);
    runId = detail.run.id;
    const finalDetail = await waitForTerminal(services, runId);
    await approvalChain; // ensure any in-flight decision settled before we exit
    if (!jsonMode) {
      writeLine("");
      writeLine(
        c.bold(`run ${finalDetail.run.id} → ${finalDetail.run.status}`) +
          (finalDetail.run.exitReason ? c.gray(`  (${finalDetail.run.exitReason})`) : ""),
      );
    }
    return finalDetail.run.status === "done" ? 0 : 1;
  } catch (err) {
    writeErrLine(`nlc run: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    try {
      services.storage.close();
    } catch {
      // closing a stale DB on shutdown is best-effort.
    }
  }
}

type StreamOpts = { jsonMode: boolean };

function streamEvent(event: AgentEvent, opts: StreamOpts): void {
  if (opts.jsonMode) {
    process.stdout.write(JSON.stringify(event) + "\n");
    return;
  }
  switch (event.kind) {
    case "delta":
      process.stdout.write(event.text);
      break;
    case "step_added": {
      const step = event.step;
      if (step.type === "tool_call") writeLine(c.blue(`→ ${step.content}`));
      else if (step.type === "tool_result") writeLine(c.gray(`  ${truncate(step.content)}`));
      else if (step.type === "error") writeLine(c.red(`✗ ${step.content}`));
      else if (step.type === "diff") writeLine(c.yellow(`diff:\n${step.content}`));
      else if (step.type === "command") writeLine(c.gray(step.content));
      else if (step.type === "message" && step.content.startsWith("Task:")) writeLine(c.bold(step.content));
      break;
    }
    case "run_updated":
      break;
    default:
      break;
  }
}

function truncate(s: string, max = 240): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

async function waitForTerminal(services: CliServices, runId: string): Promise<ReturnType<CliServices["agent"]["getDetail"]>> {
  while (true) {
    const detail = services.agent.getDetail(runId);
    if (isTerminal(detail.run.status)) return detail;
    await sleep(100);
  }
}

function isTerminal(status: string): boolean {
  return status === "done" || status === "failed" || status === "cancelled" || status === "budget_exceeded";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
