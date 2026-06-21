/** Phase 4 IPC handlers: global memory + style + learning + finetune + proactive + plugins. */

import fs from "node:fs";
import path from "node:path";
import { app, dialog } from "electron";
import {
  IPC,
  type PluginInstallation,
} from "@nlc/shared";
import {
  buildDatasetFromSignals,
  curatePairs,
} from "@nlc/learning";
import {
  KnowledgeGraph,
} from "@nlc/global-memory";
import {
  extractStyleSpec,
  type FileSample,
} from "@nlc/style-profile";
import {
  ModelRegistry,
} from "@nlc/finetune";
import {
  ProposalInbox,
  scanForDebt,
  dedupeAgainstInbox,
} from "@nlc/proactive";
import {
  PluginLoader,
  type PermissionPrompter,
  type PluginRepository,
} from "@nlc/plugin-sdk";
import { handle } from "./ipc-handle.js";
import type { Services } from "./services.js";
import {
  validateBuildPreferenceDataset,
  validateContributeGlobalPattern,
  validateCreateFinetuneJob,
  validateDeleteGlobalPattern,
  validateGetStyleSpec,
  validateInstallPlugin,
  validateListEvalRuns,
  validateListFrozenSnapshots,
  validatePluginId,
  validateProposalId,
  validatePromoteModel,
  validateRecordFeedbackSignal,
  validateRegisterWorkerNode,
  validateSetPluginEnabled,
  validateSetWorkspaceContribution,
  validateSnoozeProposal,
  validateUpdatePhase4Settings,
  validateUpsertStyleSpec,
  validateWorkspaceId,
} from "./validators.js";
import { FinetuneRunner, dispatchFinetuneJob } from "./finetune-runner.js";

type RequireRoot = (workspaceId: string) => string;

export function registerPhase4Ipc(
  services: Services,
  requireRoot: RequireRoot,
  userDataDir: string,
): void {
  const { storage, phase4Settings } = services;
  const finetuneRunner = new FinetuneRunner(services, userDataDir);
  // Resume queued jobs that may have been interrupted by an app restart.
  // Cheap when finetune is disabled (the runner short-circuits).
  finetuneRunner.resumeQueued();

  // ----- Global memory + KG -----
  const kg = new KnowledgeGraph(storage.phase4);

  handle(IPC.listGlobalPatterns, () => storage.phase4.listGlobalPatterns());
  handle(IPC.contributeGlobalPattern, (raw) => {
    const { input } = validateContributeGlobalPattern(raw);
    return kg.contribute(input);
  });
  handle(IPC.retractWorkspaceContribution, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return kg.retractProject(workspaceId);
  });
  handle(IPC.deleteGlobalPattern, (raw) => {
    const { id } = validateDeleteGlobalPattern(raw);
    return { deleted: storage.phase4.deleteGlobalPattern(id) };
  });
  handle(IPC.getWorkspaceContribution, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return storage.phase4.getWorkspaceContribution(workspaceId);
  });
  handle(IPC.setWorkspaceContribution, (raw) => {
    const { workspaceId, mode } = validateSetWorkspaceContribution(raw);
    storage.phase4.setWorkspaceContribution(workspaceId, mode);
    if (mode === "isolated") {
      // Retracting opt-in cascades: drop this workspace's contributions.
      kg.retractProject(workspaceId);
    }
    return mode;
  });

  // ----- Style profile -----
  handle(IPC.getStyleSpec, (raw) => {
    const { scope, workspaceId } = validateGetStyleSpec(raw);
    return storage.phase4.getStyleSpec(scope, workspaceId);
  });
  handle(IPC.upsertStyleSpec, (raw) => {
    const { spec } = validateUpsertStyleSpec(raw);
    return storage.phase4.upsertStyleSpec(spec);
  });
  handle(IPC.extractStyleSpecFromCodebase, async (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 50);
    const spec = extractStyleSpec(files, { scope: "project", workspaceId });
    return storage.phase4.upsertStyleSpec(spec);
  });

  // ----- Learning -----
  handle(IPC.listFeedbackSignals, (raw) => {
    const { workspaceId } = validateWorkspaceId(raw);
    return storage.phase4.listFeedbackSignals(workspaceId);
  });
  handle(IPC.recordFeedbackSignal, (raw) => {
    const { signal } = validateRecordFeedbackSignal(raw);
    return storage.phase4.createFeedbackSignal(signal);
  });
  handle(IPC.buildPreferenceDataset, (raw) => {
    const { workspaceId, name } = validateBuildPreferenceDataset(raw);
    const signals = storage.phase4.listFeedbackSignals(workspaceId);
    const result = buildDatasetFromSignals(storage.phase4, signals, { name });
    const dataset = storage.phase4.getPreferenceDataset(result.dataset.id);
    const curated = curatePairs(dataset?.pairs ?? []);
    // Persist the curated set back over the raw pairs. Without this rewrite
    // the IPC merely reported a `rejected` count while the underlying table
    // still held every raw entry, so downstream training silently consumed
    // pre-curation pairs even though the UI claimed they had been filtered.
    storage.phase4.replacePreferenceDatasetPairs(result.dataset.id, curated.kept);
    return {
      datasetId: result.dataset.id,
      built: result.built,
      rejected: result.rejected + curated.droppedFormatting + curated.droppedTooSimilar + curated.droppedLowQuality + curated.droppedDuplicates,
    };
  });
  handle(IPC.listPreferenceDatasets, () => storage.phase4.listPreferenceDatasets());

  // ----- Finetune -----
  const registry = new ModelRegistry(storage.phase4);
  handle(IPC.listFinetuneJobs, () => storage.phase4.listFinetuneJobs());
  handle(IPC.createFinetuneJob, (raw) => {
    const { input } = validateCreateFinetuneJob(raw);
    if (!phase4Settings.get().finetuneEnabled) {
      throw new Error("Fine-tune feature is disabled in Phase 4 settings");
    }
    // Create the job AND kick off the background training process. The IPC
    // returns immediately with the "queued" job; the runner transitions it to
    // "training" → "evaluating" or "failed" asynchronously. The UI subscribes
    // to listFinetuneJobs() to see status changes.
    return dispatchFinetuneJob(finetuneRunner, services, input);
  });
  handle(IPC.listModels, () => registry.list());
  handle(IPC.getActiveModel, () => registry.getActive());
  handle(IPC.promoteModel, (raw) => {
    const { modelId } = validatePromoteModel(raw);
    return registry.promote(modelId);
  });
  handle(IPC.rollbackToBaseModel, () => registry.rollbackToBase());

  // ----- Proposals -----
  const proposalInbox = new ProposalInbox(storage.phase4);
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
    const proposal = storage.phase4.getProposal(id);
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
    // proposal path inherits all the Phase 1/2 guarantees rather than
    // bypassing them.
    const detail = await services.agent.runTask(proposal.workspaceId, task);
    // Mark the proposal with the real run id so the UI can navigate from the
    // inbox entry to the resulting run, and a future re-convert is refused.
    // Returns the updated Proposal (matches the IPC contract); the renderer
    // reads `convertedRunId` to navigate to the live run.
    return proposalInbox.convert(id, detail.run.id);
  });
  handle(IPC.scanDebtNow, async (rawArgs) => {
    const { workspaceId } = validateWorkspaceId(rawArgs);
    if (!phase4Settings.get().proactiveEnabled) {
      throw new Error("Proactive mode is disabled in Phase 4 settings");
    }
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 200);
    const rawProposals = scanForDebt(workspaceId, files);
    const existing = proposalInbox.list(workspaceId);
    const deduped = dedupeAgainstInbox(rawProposals, { workspaceId, existing });
    const created = proposalInbox.ingestMany(deduped);
    return { created };
  });

  // ----- Distributed -----
  handle(IPC.listWorkerNodes, () => storage.phase4.listWorkerNodes());
  handle(IPC.registerWorkerNode, (raw) => {
    const { node } = validateRegisterWorkerNode(raw);
    if (!phase4Settings.get().distributedEnabled) {
      throw new Error("Distributed mode is disabled in Phase 4 settings");
    }
    return storage.phase4.upsertWorkerNode(node);
  });

  // ----- Plugins -----
  // The PluginLoader is the ONLY path that may install a plugin: it runs the
  // SDK manifest validator (rejects bad semver, non-snake_case tools, unknown
  // permissions), then asks the user to approve each requested permission via
  // an OS dialog before anything reaches the database. The previous
  // installPlugin handler skipped both steps and trusted whatever the
  // renderer sent — a compromised renderer could install a plugin claiming
  // any permission set. Fixed.
  const pluginRepo: PluginRepository = {
    installPlugin: (manifest, installPath, perms) =>
      storage.phase4.installPlugin(manifest, installPath, perms),
    listPlugins: () => storage.phase4.listPlugins(),
    setPluginEnabled: (id, enabled) => storage.phase4.setPluginEnabled(id, enabled),
    uninstallPlugin: (id) => storage.phase4.uninstallPlugin(id),
  };
  // Fallback prompter used only when the install IPC arrives without
  // pre-approval (e.g., a future programmatic install path). The renderer's
  // PluginManager form ships `approvedPermissions` per-checkbox and goes
  // through the pre-approval path in PluginLoader.install, bypassing this
  // dialog entirely.
  const pluginPrompter: PermissionPrompter = {
    async ask(manifest, requested) {
      if (requested.length === 0) return [];
      const lines = requested.map((p, i) => `${i + 1}. ${p}`).join("\n");
      const result = await dialog.showMessageBox({
        type: "warning",
        title: `Install plugin: ${manifest.name}`,
        message: `Approve permissions for "${manifest.name}" v${manifest.version}?`,
        detail:
          `This plugin requests the following permissions:\n\n${lines}\n\n` +
          `Click "Approve all" to grant every permission, or "Cancel" to abort the install. ` +
          `For per-permission approval, use the install dialog in the renderer UI instead.`,
        buttons: ["Cancel", "Approve all"],
        defaultId: 0,
        cancelId: 0,
      });
      return result.response === 1 ? requested : [];
    },
  };
  const pluginLoader = new PluginLoader(pluginRepo, pluginPrompter);

  handle(IPC.listPlugins, () => storage.phase4.listPlugins());
  handle(IPC.installPlugin, async (raw): Promise<PluginInstallation> => {
    if (!phase4Settings.get().pluginsEnabled) {
      throw new Error("Plugins feature is disabled in Phase 4 settings");
    }
    const validated = validateInstallPlugin(raw);
    const result = await pluginLoader.install(
      validated.manifest,
      validated.installPath,
      validated.approvedPermissions,
    );
    if (!result.ok) throw new Error(result.reason);
    return result.installation;
  });
  handle(IPC.setPluginEnabled, (raw) => {
    const { id, enabled } = validateSetPluginEnabled(raw);
    return storage.phase4.setPluginEnabled(id, enabled);
  });
  handle(IPC.uninstallPlugin, (raw) => {
    const { id } = validatePluginId(raw);
    return { uninstalled: storage.phase4.uninstallPlugin(id) };
  });

  // ----- Evals -----
  handle(IPC.listFrozenSnapshots, (raw) => {
    const a = validateListFrozenSnapshots(raw);
    return storage.phase4.listFrozenSuiteSnapshots(a.modelId);
  });
  handle(IPC.listEvalRuns, (raw) => {
    const a = validateListEvalRuns(raw);
    return storage.phase4.listEvalRuns(a.taskId, a.modelId);
  });

  // ----- Settings -----
  handle(IPC.getPhase4Settings, () => phase4Settings.get());
  handle(IPC.updatePhase4Settings, (raw) => {
    const { settings: next } = validateUpdatePhase4Settings(raw);
    return phase4Settings.set(next);
  });

  // ----- Proactive scheduler -----
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
    const flags = services.phase4Settings.get();
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
      const flags = services.phase4Settings.get();
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

async function readSampleFiles(root: string, max: number): Promise<FileSample[]> {
  const out: FileSample[] = [];
  const stack: string[] = [root];
  const ignored = new Set(["node_modules", ".git", "dist", "out", "build", ".next", ".venv", "__pycache__"]);
  while (stack.length > 0 && out.length < max) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(full);
        continue;
      }
      if (out.length >= max) break;
      if (!/\.(ts|tsx|js|jsx|json|md)$/.test(entry.name)) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.size > 200_000) continue;
        const content = fs.readFileSync(full, "utf-8");
        out.push({
          path: path.relative(root, full),
          content,
          lastModified: stat.mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  return out;
}
