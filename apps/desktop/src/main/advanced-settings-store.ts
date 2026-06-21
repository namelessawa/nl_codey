/**
 * Advanced-feature settings store. Persisted as
 * `<userData>/advanced-settings.json` (held under the legacy filename
 * `phase4-settings.json` on existing installs — both are accepted on read,
 * new writes prefer the new name).
 *
 * Both `services.ts` (for the AgentService prompt augmentation gate) and
 * the advanced-settings IPC handler hold a reference to a single instance
 * so reads/writes stay consistent within a session.
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ADVANCED_SETTINGS,
  mergeAdvancedSettings,
  type AdvancedSettings,
} from "@nlc/shared";

const NEW_FILENAME = "advanced-settings.json";
const LEGACY_FILENAME = "phase4-settings.json";

export class AdvancedSettingsStore {
  private cache: AdvancedSettings | null = null;
  constructor(private readonly userDataDir: string) {}

  private newFile(): string {
    return path.join(this.userDataDir, NEW_FILENAME);
  }

  private legacyFile(): string {
    return path.join(this.userDataDir, LEGACY_FILENAME);
  }

  get(): AdvancedSettings {
    if (this.cache) return this.cache;
    const readFrom = (p: string): Partial<AdvancedSettings> | null => {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<AdvancedSettings>;
      } catch {
        return null;
      }
    };
    const parsed = readFrom(this.newFile()) ?? readFrom(this.legacyFile());
    this.cache = parsed ? mergeAdvancedSettings(parsed) : { ...DEFAULT_ADVANCED_SETTINGS };
    return this.cache;
  }

  set(next: AdvancedSettings): AdvancedSettings {
    this.cache = next;
    try {
      fs.mkdirSync(this.userDataDir, { recursive: true });
      // Write owner-only (0o600) to mirror the main settings/store.ts
      // contract. Advanced settings don't carry secrets today, but the file
      // does record feature flags and worker-node endpoints that have no
      // business being world-readable on a multi-user POSIX system.
      fs.writeFileSync(this.newFile(), JSON.stringify(next, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // best-effort persistence; in-memory cache still reflects the update
    }
    return next;
  }
}
