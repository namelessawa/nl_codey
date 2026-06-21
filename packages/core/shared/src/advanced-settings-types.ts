/** Advanced (formerly Phase 4) feature-flag bundle and defaults. */

import type { WorkspaceContributionMode } from "./kg-types.js";

export type AdvancedSettings = {
  globalMemoryEnabled: boolean;
  styleProfileEnabled: boolean;
  learningEnabled: boolean;
  finetuneEnabled: boolean;
  distributedEnabled: boolean;
  proactiveEnabled: boolean;
  pluginsEnabled: boolean;
  /** When true, this workspace contributes to the global pattern pool. */
  contributionMode: WorkspaceContributionMode;
  /** Background scan cadence for proactive mode (minutes between scans). */
  proactiveScanIntervalMin: number;
};

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  globalMemoryEnabled: false,
  styleProfileEnabled: true,
  learningEnabled: true,
  finetuneEnabled: false,
  distributedEnabled: false,
  proactiveEnabled: false,
  pluginsEnabled: false,
  contributionMode: "isolated",
  proactiveScanIntervalMin: 30,
};

export function mergeAdvancedSettings(
  partial: Partial<AdvancedSettings> | null | undefined,
): AdvancedSettings {
  return { ...DEFAULT_ADVANCED_SETTINGS, ...(partial ?? {}) };
}
