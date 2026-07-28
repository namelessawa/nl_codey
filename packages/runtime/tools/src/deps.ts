import type { FileSnapshot } from "@nlc/shared";

/**
 * Minimal persistence surface the mutating tools need. @nlc/storage's
 * Storage class satisfies this structurally, keeping tools decoupled from it.
 */
export interface SnapshotStore {
  addSnapshot(
    runId: string,
    filePath: string,
    beforeContent: string,
    options?: { beforeExisted?: boolean },
  ): FileSnapshot;
  setSnapshotAfter(snapshotId: string, afterContent: string, afterExisted?: boolean): void;
}
