import path from "node:path";
import { app } from "electron";
import { AgentService } from "@coding-agent/agent-core";
import { createLLMProvider, createLLMProviderFromEnv } from "@coding-agent/llm";
import { Storage } from "@coding-agent/storage";
import type { AgentEvent } from "@coding-agent/shared";
import { SettingsStore } from "./settings/store.js";
import { InstallationGate } from "./installation-gate.js";

export type Services = {
  storage: Storage;
  settings: SettingsStore;
  agent: AgentService;
  /** Docker availability + user skip choice (instruction branch). */
  installationGate: InstallationGate;
};

/** Build the storage + settings + agent service. `emit` broadcasts live events. */
export function buildServices(emit: (event: AgentEvent) => void): Services {
  const userData = app.getPath("userData");
  const dataDir = path.join(userData, "data");
  const dbPath = path.join(dataDir, "workspace-state.db");
  const storage = new Storage(dbPath);
  const settings = new SettingsStore(userData);
  const installationGate = new InstallationGate(userData, emit);

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
    // Read-only ("instruction") mode: the shipped agent is a query-only
    // assistant. It can read, search, and explain the project but the
    // file-mutating tools (apply_patch / write_file) are stripped from its
    // schema and hard-refused at dispatch — the LLM can never modify or delete
    // a file. This is a fixed branch policy, not a user-toggleable setting.
    readOnly: true,
    // Tool-dispatch gate: refuse unsafe tools (`run_command`, `apply_patch`,
    // `write_file`) when Docker is missing and the user skipped the install
    // prompt. Catches both user-typed commands AND LLM-initiated tool calls
    // inside the autonomous loop. Bound so `this` inside the gate keeps
    // pointing at the InstallationGate instance.
    assertToolAllowed: (toolName: string) => installationGate.assertToolAllowed(toolName),
    emit,
  });

  return { storage, settings, agent, installationGate };
}
