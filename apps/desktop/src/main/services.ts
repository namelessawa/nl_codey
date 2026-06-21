import fs from "node:fs";
import path from "node:path";
import {
  AgentService,
  buildPromptAugmentation,
} from "@nlc/agent-core";
import { createLLMProvider, createLLMProviderFromEnv } from "@nlc/llm";
import { Storage } from "@nlc/storage";
import { nlcRoot, type AgentEvent } from "@nlc/shared";
import { SettingsStore } from "./settings/store.js";
import { InstallationGate } from "./installation-gate.js";
import { Phase4SettingsStore } from "./phase4-settings-store.js";
import { buildExtendedPorts } from "./extended-ports.js";
import { buildPluginBundle } from "./plugin-runtime.js";

export type Services = {
  storage: Storage;
  settings: SettingsStore;
  agent: AgentService;
  /** Docker availability + user skip choice (instruction branch). */
  installationGate: InstallationGate;
  /**
   * Phase 4 feature-flag store. Shared between AgentService (so it can gate the
   * prompt augmentation and tool wiring) and the Phase 4 IPC handlers so the
   * UI and the runtime always agree on what's enabled.
   */
  phase4Settings: Phase4SettingsStore;
  /**
   * Broadcast a live event to the renderer. Exposed on the Services bundle so
   * IPC handlers (e.g. the semantic-index rebuild) can publish Phase 3
   * `index_status` updates without a back-channel reference.
   */
  emit: (event: AgentEvent) => void;
  /**
   * Absolute path to the resolved NL_Codey data root (`~/.nlc` or whatever
   * `NLC_HOME` overrides to). Exposed so IPC handlers and the CLI surface can
   * read/write peripheral state (Phase 4 datasets, plugin installs, etc.)
   * without re-resolving the path themselves.
   */
  dataRoot: string;
};

/**
 * Build the storage + settings + agent service.
 *
 * The GUI is just a view of {@link nlcRoot} — both Electron and the `nlc` CLI
 * go through the same factory so the on-disk state is single-sourced. `emit`
 * broadcasts live events; the optional `dataRoot` override exists for tests
 * and the CLI's `--data-root` flag.
 */
export function buildServices(
  emit: (event: AgentEvent) => void,
  opts: { dataRoot?: string } = {},
): Services {
  const dataRoot = opts.dataRoot ?? nlcRoot();
  fs.mkdirSync(dataRoot, { recursive: true });
  const dataDir = path.join(dataRoot, "data");
  const dbPath = path.join(dataDir, "workspace-state.db");
  const storage = new Storage(dbPath);
  const settings = new SettingsStore(dataRoot);
  const installationGate = new InstallationGate(dataRoot, emit);
  const phase4Settings = new Phase4SettingsStore(dataRoot);

  // Forward-declared so the dep callbacks can refer to the services bundle
  // after it's fully built. AgentService construction takes the closures by
  // value, so they capture this lexical binding and resolve through it on
  // every invocation.
  let bundle: Services;

  const agent = new AgentService({
    storage,
    // Resolve a provider per run from current settings. When no API key is set
    // we fall back to the env provider (mock by default) so the Phase-1 flow
    // still works out of the box without configuration.
    resolveLLM: () => {
      const config = settings.getLLMConfig();
      if (!config.apiKey) return createLLMProviderFromEnv(process.env);
      return createLLMProvider(config);
    },
    getAgentSettings: () => settings.getSettings().agent,
    // Thread the user's UI language into the agent so the system prompt and
    // the compression summary prompt match the language they're reading the
    // UI in. Re-read per run so settings changes take effect without restart.
    getLanguage: () => settings.getSettings().ui.language,
    // Tool-dispatch gate: refuse unsafe tools (`run_command`, `apply_patch`,
    // `write_file`) when Docker is missing and the user skipped the install
    // prompt. Catches both user-typed commands AND LLM-initiated tool calls
    // inside the autonomous loop. Bound so `this` inside the gate keeps
    // pointing at the InstallationGate instance.
    assertToolAllowed: (toolName: string) => installationGate.assertToolAllowed(toolName),
    // Phase 4 prompt augmentation: composed from cross-project GlobalPatterns
    // (when globalMemoryEnabled), the StyleSpec (when styleProfileEnabled),
    // and the fine-tune identity reminder (when the active model is not a
    // base model). Failures are swallowed so an unhealthy Phase 4 surface
    // never blocks a normal run; the agent silently falls back to the
    // Phase 1/2 prompt.
    getPhase4Augmentation: (workspaceId: string) => {
      try {
        const flags = phase4Settings.get();
        const globalPatterns = flags.globalMemoryEnabled
          ? storage.kg.listGlobalPatterns(20).slice(0, 3)
          : undefined;
        const styleSpec = flags.styleProfileEnabled
          ? storage.style.getStyleSpec("project", workspaceId) ??
            storage.style.getStyleSpec("global", null)
          : null;
        const activeModel = storage.finetune.getActiveModel();
        const includeModelIdentityReminder = !!activeModel && activeModel.kind !== "base";
        return buildPromptAugmentation({
          ...(globalPatterns ? { globalPatterns } : {}),
          styleSpec,
          includeModelIdentityReminder,
        });
      } catch {
        return "";
      }
    },
    // Phase 3 ports: semantic_search / read_memory / write_memory / web_search /
    // web_fetch become available to the model when this returns non-null.
    // Built per-run so settings changes (API key, embedder backend) take
    // effect on the next task. Failure returns null and the agent silently
    // falls back to the Phase 1/2 tool surface.
    getPhase3Ports: (workspaceId: string) => {
      try {
        return buildExtendedPorts(bundle, workspaceId);
      } catch {
        return null;
      }
    },
    // Dynamic tool bundle: plugins enabled in the database become available
    // to the model as `plugin__<name>__<tool>` calls routed through
    // PluginHost (re-checks enablement + permissions per invocation).
    // Re-resolved per loop entry so an install/enable/disable lights up on
    // the next task without restart. Failures fall back to no plugin tools.
    getDynamicTools: () => {
      try {
        return buildPluginBundle(bundle);
      } catch {
        return null;
      }
    },
    emit,
  });

  bundle = { storage, settings, agent, installationGate, phase4Settings, emit, dataRoot };
  return bundle;
}
