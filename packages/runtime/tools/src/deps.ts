import type { FileSnapshot } from "@nlc/shared";

/**
 * Minimal persistence surface the mutating tools need. @nlc/storage's
 * Storage class satisfies this structurally, keeping tools decoupled from it.
 */
export interface SnapshotStore {
  addSnapshot(runId: string, filePath: string, beforeContent: string): FileSnapshot;
  setSnapshotAfter(snapshotId: string, afterContent: string): void;
}
