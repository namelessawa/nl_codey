import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ADVANCED_SETTINGS } from "@nlc/shared";
import { AdvancedSettingsStore } from "./advanced-settings-store.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("AdvancedSettingsStore distributed boundary", () => {
  it("migrates a persisted enabled flag to the production-safe default", () => {
    const root = temporaryRoot();
    fs.writeFileSync(
      path.join(root, "advanced-settings.json"),
      JSON.stringify({
        ...DEFAULT_ADVANCED_SETTINGS,
        distributedEnabled: true,
      }),
      "utf8",
    );

    expect(new AdvancedSettingsStore(root).get().distributedEnabled).toBe(false);
  });

  it("normalizes direct writes so the unavailable feature stays disabled", () => {
    const root = temporaryRoot();
    const store = new AdvancedSettingsStore(root);

    const saved = store.set({
      ...DEFAULT_ADVANCED_SETTINGS,
      distributedEnabled: true,
    });
    const persisted = JSON.parse(
      fs.readFileSync(path.join(root, "advanced-settings.json"), "utf8"),
    ) as { distributedEnabled?: unknown };

    expect(saved.distributedEnabled).toBe(false);
    expect(persisted.distributedEnabled).toBe(false);
  });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nlc-advanced-settings-"));
  roots.push(root);
  return root;
}
