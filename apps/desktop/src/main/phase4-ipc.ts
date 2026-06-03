/** Phase 4 IPC handlers: global memory + style + learning + finetune + proactive + plugins. */

import fs from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import {
  DEFAULT_PHASE4_SETTINGS,
  IPC,
  mergePhase4Settings,
  type FeedbackSignalInput,
  type FinetuneJobInput,
  type GlobalPatternInput,
  type Phase4Settings,
  type PluginInstallation,
  type PluginManifest,
  type PluginPermission,
  type StyleScope,
  type StyleSpec,
  type WorkerNode,
  type WorkspaceContributionMode,
  type WorkspaceIdArgs,
} from "@coding-agent/shared";
import {
  buildDatasetFromSignals,
  curatePairs,
} from "@coding-agent/learning";
import {
  KnowledgeGraph,
} from "@coding-agent/global-memory";
import {
  extractStyleSpec,
  type FileSample,
} from "@coding-agent/style-profile";
import {
  ModelRegistry,
} from "@coding-agent/finetune";
import {
  ProposalInbox,
  scanForDebt,
  dedupeAgainstInbox,
} from "@coding-agent/proactive";
import {
  PluginLoader,
  type PermissionPrompter,
  type PluginRepository,
} from "@coding-agent/plugin-sdk";
import { handle } from "./ipc-handle.js";
import type { Services } from "./services.js";
import { validateInstallPlugin } from "./validators.js";

type RequireRoot = (workspaceId: string) => string;

/**
 * Phase 4 settings live alongside Phase 1-3 settings as a separate JSON file.
 * Kept separate so users can enable/disable Phase 4 modules without forcing a
 * full settings migration.
 */
class Phase4SettingsStore {
  private cache: Phase4Settings | null = null;
  constructor(private readonly userDataDir: string) {}

  private file(): string {
    return path.join(this.userDataDir, "phase4-settings.json");
  }

  get(): Phase4Settings {
    if (this.cache) return this.cache;
    try {
      const raw = fs.readFileSync(this.file(), "utf-8");
      const parsed = JSON.parse(raw) as Partial<Phase4Settings>;
      this.cache = mergePhase4Settings(parsed);
    } catch {
      this.cache = { ...DEFAULT_PHASE4_SETTINGS };
    }
    return this.cache;
  }

  set(next: Phase4Settings): Phase4Settings {
    this.cache = next;
    try {
      fs.mkdirSync(this.userDataDir, { recursive: true });
      fs.writeFileSync(this.file(), JSON.stringify(next, null, 2), "utf-8");
    } catch {
      // settings persistence is best-effort
    }
    return next;
  }
}

export function registerPhase4Ipc(services: Services, requireRoot: RequireRoot, userDataDir: string): void {
  const { storage } = services;
  const phase4Settings = new Phase4SettingsStore(userDataDir);

  // ----- Global memory + KG -----
  const kg = new KnowledgeGraph(storage.phase4);

  handle(IPC.listGlobalPatterns, () => storage.phase4.listGlobalPatterns());
  handle(IPC.contributeGlobalPattern, (args) => {
    const { input } = args as { input: GlobalPatternInput };
    return kg.contribute(input);
  });
  handle(IPC.retractWorkspaceContribution, (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    return kg.retractProject(workspaceId);
  });
  handle(IPC.deleteGlobalPattern, (args) => {
    const { id } = args as { id: string };
    return { deleted: storage.phase4.deleteGlobalPattern(id) };
  });
  handle(IPC.getWorkspaceContribution, (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    return storage.phase4.getWorkspaceContribution(workspaceId);
  });
  handle(IPC.setWorkspaceContribution, (args) => {
    const { workspaceId, mode } = args as { workspaceId: string; mode: WorkspaceContributionMode };
    storage.phase4.setWorkspaceContribution(workspaceId, mode);
    if (mode === "isolated") {
      // Retracting opt-in cascades: drop this workspace's contributions.
      kg.retractProject(workspaceId);
    }
    return mode;
  });

  // ----- Style profile -----
  handle(IPC.getStyleSpec, (args) => {
    const { scope, workspaceId } = args as { scope: StyleScope; workspaceId: string | null };
    return storage.phase4.getStyleSpec(scope, workspaceId);
  });
  handle(IPC.upsertStyleSpec, (args) => {
    const { spec } = args as { spec: StyleSpec };
    return storage.phase4.upsertStyleSpec(spec);
  });
  handle(IPC.extractStyleSpecFromCodebase, async (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 50);
    const spec = extractStyleSpec(files, { scope: "project", workspaceId });
    return storage.phase4.upsertStyleSpec(spec);
  });

  // ----- Learning -----
  handle(IPC.listFeedbackSignals, (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    return storage.phase4.listFeedbackSignals(workspaceId);
  });
  handle(IPC.recordFeedbackSignal, (args) => {
    const { signal } = args as { signal: FeedbackSignalInput };
    return storage.phase4.createFeedbackSignal(signal);
  });
  handle(IPC.buildPreferenceDataset, (args) => {
    const { workspaceId, name } = args as { workspaceId: string; name?: string };
    const signals = storage.phase4.listFeedbackSignals(workspaceId);
    const result = buildDatasetFromSignals(storage.phase4, signals, { name });
    const dataset = storage.phase4.getPreferenceDataset(result.dataset.id);
    const curated = curatePairs(dataset?.pairs ?? []);
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
  handle(IPC.createFinetuneJob, (args) => {
    const { input } = args as { input: FinetuneJobInput };
    if (!phase4Settings.get().finetuneEnabled) {
      throw new Error("Fine-tune feature is disabled in Phase 4 settings");
    }
    return storage.phase4.createFinetuneJob(input);
  });
  handle(IPC.listModels, () => registry.list());
  handle(IPC.getActiveModel, () => registry.getActive());
  handle(IPC.promoteModel, (args) => {
    const { modelId } = args as { modelId: string };
    return registry.promote(modelId);
  });
  handle(IPC.rollbackToBaseModel, () => registry.rollbackToBase());

  // ----- Proposals -----
  const proposalInbox = new ProposalInbox(storage.phase4);
  handle(IPC.listProposals, (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    return proposalInbox.list(workspaceId);
  });
  handle(IPC.snoozeProposal, (args) => {
    const { id, untilTs } = args as { id: string; untilTs: number };
    return proposalInbox.snooze(id, untilTs);
  });
  handle(IPC.dismissProposal, (args) => {
    const { id } = args as { id: string };
    return proposalInbox.dismiss(id);
  });
  handle(IPC.convertProposal, (args) => {
    const { id } = args as { id: string };
    // EXPERIMENTAL: this handler used to record a synthetic `pending-<id>`
    // run id and mark the proposal "converted", but that synthetic id was
    // never wired to the Planner pipeline — clicking "Convert" looked like
    // it did something but produced no actual run. Until the proper handoff
    // to AgentService/Planner is built, refuse the call so the user gets a
    // clear "not yet available" message instead of a silent no-op. The
    // proposal itself is left untouched; snooze and dismiss still work.
    void id;
    throw new Error(
      "Converting a proposal to a run is not yet wired to the Planner pipeline. " +
        "Use snooze or dismiss for now; the conversion flow will land in a future release.",
    );
  });
  handle(IPC.scanDebtNow, async (args) => {
    const { workspaceId } = args as WorkspaceIdArgs;
    if (!phase4Settings.get().proactiveEnabled) {
      throw new Error("Proactive mode is disabled in Phase 4 settings");
    }
    const root = requireRoot(workspaceId);
    const files = await readSampleFiles(root, 200);
    const raw = scanForDebt(workspaceId, files);
    const existing = proposalInbox.list(workspaceId);
    const deduped = dedupeAgainstInbox(raw, { workspaceId, existing });
    const created = proposalInbox.ingestMany(deduped);
    return { created };
  });

  // ----- Distributed -----
  handle(IPC.listWorkerNodes, () => storage.phase4.listWorkerNodes());
  handle(IPC.registerWorkerNode, (args) => {
    const { node } = args as { node: Omit<WorkerNode, "registeredAt"> };
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
          `Per-permission approval will be available in a future release.`,
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
    const result = await pluginLoader.install(validated.manifest, validated.installPath);
    if (!result.ok) throw new Error(result.reason);
    return result.installation;
  });
  handle(IPC.setPluginEnabled, (args) => {
    const a = args as { id: string; enabled: boolean };
    if (typeof a.id !== "string" || a.id.length === 0) {
      throw new Error("IPC payload rejected: id must be a non-empty string");
    }
    if (typeof a.enabled !== "boolean") {
      throw new Error("IPC payload rejected: enabled must be a boolean");
    }
    return storage.phase4.setPluginEnabled(a.id, a.enabled);
  });
  handle(IPC.uninstallPlugin, (args) => {
    const a = args as { id: string };
    if (typeof a.id !== "string" || a.id.length === 0) {
      throw new Error("IPC payload rejected: id must be a non-empty string");
    }
    return { uninstalled: storage.phase4.uninstallPlugin(a.id) };
  });

  // ----- Evals -----
  handle(IPC.listFrozenSnapshots, (args) => {
    const a = (args as { modelId?: string } | undefined) ?? {};
    return storage.phase4.listFrozenSuiteSnapshots(a.modelId);
  });
  handle(IPC.listEvalRuns, (args) => {
    const a = (args as { taskId?: string; modelId?: string } | undefined) ?? {};
    return storage.phase4.listEvalRuns(a.taskId, a.modelId);
  });

  // ----- Settings -----
  handle(IPC.getPhase4Settings, () => phase4Settings.get());
  handle(IPC.updatePhase4Settings, (args) => {
    const { settings: next } = args as { settings: Phase4Settings };
    return phase4Settings.set(next);
  });
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
