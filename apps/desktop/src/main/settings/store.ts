import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  toLLMConfig,
  type AppSettings,
  type LLMConfig,
} from "@nlc/shared";
import { SecretStore } from "./secret.js";

/**
 * Owns persistence of {@link AppSettings}. Non-secret fields live in
 * `settings.json`; the API key is delegated to {@link SecretStore} and is never
 * written to that JSON file. All callers in main go through this class, so the
 * renderer never touches the files directly.
 */
export class SettingsStore {
  private readonly filePath: string;
  private readonly secrets: SecretStore;
  private cache: AppSettings;

  constructor(dir: string) {
    this.filePath = path.join(dir, "settings.json");
    this.secrets = new SecretStore(dir);
    this.cache = this.load();
  }

  /** True when the API key can be durably encrypted on this machine. */
  secretsArePersistent(): boolean {
    return this.secrets.isPersistent();
  }

  /** Full settings, including the decrypted API key, for the settings UI. */
  getSettings(): AppSettings {
    return {
      ...this.cache,
      llm: { ...this.cache.llm, apiKey: this.secrets.get() },
    };
  }

  /** Replace settings. The API key is split out to the secret store. */
  updateSettings(next: AppSettings): AppSettings {
    const merged = mergeSettings(next);
    this.secrets.set(merged.llm.apiKey);
    this.cache = this.stripKey(merged);
    this.persist();
    return this.getSettings();
  }

  /** Restore defaults and clear the stored API key. */
  resetSettings(): AppSettings {
    this.secrets.clear();
    this.cache = this.stripKey(DEFAULT_SETTINGS);
    this.persist();
    return this.getSettings();
  }

  /** Provider-building config with the decrypted key, for LLM calls. */
  getLLMConfig(): LLMConfig {
    return toLLMConfig({ ...this.cache.llm, apiKey: this.secrets.get() });
  }

  // --- internals ---

  private load(): AppSettings {
    try {
      if (!fs.existsSync(this.filePath)) return this.stripKey(DEFAULT_SETTINGS);
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return this.stripKey(mergeSettings(parsed));
    } catch {
      // Unreadable/corrupt config: fall back to defaults rather than crash.
      return this.stripKey(DEFAULT_SETTINGS);
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
  }

  /** Ensure the cached/persisted JSON never carries the raw API key. */
  private stripKey(settings: AppSettings): AppSettings {
    return { ...settings, llm: { ...settings.llm, apiKey: "" } };
  }
}
