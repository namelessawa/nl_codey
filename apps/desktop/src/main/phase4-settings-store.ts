/**
 * Phase 4 feature-flag store. Persisted as `<userData>/phase4-settings.json`,
 * separate from the main settings.json so users can enable/disable Phase 4
 * modules without forcing a full settings migration.
 *
 * Both `services.ts` (for the AgentService prompt augmentation gate) and
 * `phase4-ipc.ts` (for the IPC handlers) hold a reference to a single
 * instance so reads/writes stay consistent within a session.
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_PHASE4_SETTINGS,
  mergePhase4Settings,
  type Phase4Settings,
} from "@coding-agent/shared";

export class Phase4SettingsStore {
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
      // best-effort persistence; in-memory cache still reflects the update
    }
    return next;
  }
}
