/**
 * CLI-side agent service factory. Mirrors `apps/desktop/src/main/services.ts`
 * but without the Electron-only pieces (safeStorage-backed SettingsStore,
 * InstallationGate, Phase 4 settings store, plugin runtime). The resulting
 * AgentService is enough to drive `nlc run`'s headless agent loop.
 *
 * Like the desktop factory, this reads from {@link nlcRoot}; the CLI does
 * not have its own data directory.
 */
import fs from "node:fs";
import path from "node:path";
import { AgentService } from "@nlc/agent-core";
import { createLLMProvider, createLLMProviderFromEnv } from "@nlc/llm";
import { Storage } from "@nlc/storage";
import { nlcRoot, type AgentEvent } from "@nlc/shared";
import { cliLlmConfig, loadCliSettings } from "./settings.js";

export type CliServices = {
  storage: Storage;
  agent: AgentService;
  dataRoot: string;
  startupRecoveries: ReturnType<Storage["reconcileInterruptedRuns"]>;
};

export type BuildCliServicesOpts = {
  /** Override the data root (CLI `--data-root` flag, tests). */
  dataRoot?: string;
  /** Receive every AgentEvent — caller wires this to the TUI / stdout. */
  emit: (event: AgentEvent) => void;
};

export function buildCliServices(opts: BuildCliServicesOpts): CliServices {
  const dataRoot = opts.dataRoot ?? nlcRoot();
  fs.mkdirSync(dataRoot, { recursive: true });
  const dbPath = path.join(dataRoot, "data", "workspace-state.db");
  const storage = new Storage(dbPath);
  const startupRecoveries = storage.reconcileInterruptedRuns();

  const agent = new AgentService({
    storage,
    resolveLLM: () => {
      const settings = loadCliSettings(dataRoot);
      const config = cliLlmConfig(settings);
      if (!config.apiKey) return createLLMProviderFromEnv(process.env);
      return createLLMProvider(config);
    },
    getAgentSettings: () => loadCliSettings(dataRoot).appSettings.agent,
    getLanguage: () => loadCliSettings(dataRoot).appSettings.ui.language,
    emit: opts.emit,
  });

  return { storage, agent, dataRoot, startupRecoveries };
}
