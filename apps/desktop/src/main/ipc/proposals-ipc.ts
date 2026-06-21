/** Proposals (proactive debt) IPC + the background proactive scheduler. */

import { app } from "electron";
import { IPC } from "@nlc/shared";
import {
  ProposalInbox,
  scanForDebt,
  dedupeAgainstInbox,
} from "@nlc/proactive";
import {
  validateProposalId,
  validateSnoozeProposal,
  validateWorkspaceId,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import { readSampleFiles } from "../file-sampler.js";
import type { Services } from "../services.js";

type RequireRoot = (workspaceId: string) => string;

export function registerProposalsIpc(services: Services, requireRoot: RequireRoot): void {
  const { storage, advancedSettings } = services;
  const proposalInbox = new ProposalInbox(storage.proposals);

  handle(IPC.listProposals, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return proposalInbox.list(workspaceId);
  });
  handle(IPC.snoozeProposal, (raw) => {
    const { id, untilTs } = validateSnoozeProposal(raw);
    return proposalInbox.snooze(id, untilTs);
  });
  handle(IPC.dismissProposal, (raw) => {
    const { id } = validateProposalId(raw);
    return proposalInbox.dismiss(id);
  });
  handle(IPC.convertProposal, async (raw) => {
    const { id } = validateProposalId(raw);
    const proposal = storage.proposals.getProposal(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    if (proposal.status === "converted_to_task") {
      throw new Error("Proposal has already been converted to a run.");
    }
    // Compose a self-contained user task from the proposal so the agent has
    // full context the moment it starts. The original proposal id is included
    // so the model can cross-reference the inbox entry and the convertedRunId
    // backlink stays meaningful even if the proposal text later changes.
    const lines = [
      `[Proposal ${proposal.id}] ${proposal.title}`,
      "",
      proposal.rationale,
    ];
    if (proposal.affectedFiles.length > 0) {
      lines.push("", "受影响文件：");
      for (const file of proposal.affectedFiles) lines.push(`- ${file}`);
    }
    const task = lines.join("\n");
    // Hand off to the existing single-agent loop. This reuses every safety
    // gate (approval, sandbox policy, budget, installation gate), so the
    // proposal path inherits all the safety guarantees rather than
    // bypassing them.
    const detail = await services.agent.runTask(proposal.workspaceId, task);
    // Mark the proposal with the real run id so the UI can navigate from the
    // inbox entry to the resulting run, and a future re-convert is refused.
    return proposalInbox.convert(id, detail.run.id);
  });
  handle(IPC.scanDebtNow, async (rawArgs) => {
    const { workspaceId } = validateWorkspaceId(rawArgs);
    if (!advancedSettings.get().proactiveEnabled) {
      throw new Error("Proactive mode is disabled in advanced settings");
    }
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 200);
    const rawProposals = scanForDebt(workspaceId, files);
    const existing = proposalInbox.list(workspaceId);
    const deduped = dedupeAgainstInbox(rawProposals, { workspaceId, existing });
    const created = proposalInbox.ingestMany(deduped);
    return { created };
  });

  // ----- Background scheduler -----
  // proactiveScanIntervalMin was previously dead config: only `scanDebtNow`
  // (manual button) ran the debt scan. This setTimeout-chained loop honors
  // both the toggle (proactiveEnabled) and the cadence on every tick, so a
  // settings change applies on the next iteration without a restart. The
  // timer is unref'd and a before-quit hook cancels it cleanly.
  const stopScheduler = startProactiveScheduler({
    services,
    requireRoot,
    proposalInbox,
  });
  app.on("before-quit", stopScheduler);
}

type SchedulerDeps = {
  services: Services;
  requireRoot: RequireRoot;
  proposalInbox: ProposalInbox;
};

function startProactiveScheduler(deps: SchedulerDeps): () => void {
  const { services, requireRoot, proposalInbox } = deps;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running = false;

  const computeNextDelayMs = (): number => {
    const flags = services.advancedSettings.get();
    // Clamp to [1, 1440] minutes to defend against settings-store drift; the
    // UI already enforces the same range, but a manually edited JSON file
    // could bypass it.
    const min = Math.max(1, Math.min(1440, flags.proactiveScanIntervalMin));
    return min * 60_000;
  };

  const tick = async (): Promise<void> => {
    if (stopped || running) {
      schedule();
      return;
    }
    running = true;
    try {
      const flags = services.advancedSettings.get();
      if (!flags.proactiveEnabled) return; // toggle off — skip scan, keep ticking
      // Scan up to 10 most-recently-opened workspaces per tick. A user with
      // dozens of historical workspaces shouldn't pay the full sweep cost
      // every interval; the active ones are the ones worth scanning.
      const workspaces = services.storage.listWorkspaces(10);
      for (const ws of workspaces) {
        if (stopped) return;
        try {
          const root = requireRoot(ws.id);
          const files = await readSampleFiles(root, 200);
          const raw = scanForDebt(ws.id, files);
          const existing = proposalInbox.list(ws.id);
          const deduped = dedupeAgainstInbox(raw, { workspaceId: ws.id, existing });
          proposalInbox.ingestMany(deduped);
        } catch {
          // Per-workspace failures (workspace root missing, permission
          // denied, etc.) must never break the scheduler for other workspaces.
        }
      }
    } finally {
      running = false;
      schedule();
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tick();
    }, computeNextDelayMs());
    timer.unref?.();
  };

  schedule(); // First tick happens after one interval, not immediately on startup.

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
