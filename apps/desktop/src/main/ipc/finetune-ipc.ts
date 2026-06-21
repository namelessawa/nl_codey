/** Finetune IPC handlers: jobs + model registry + eval history. */

import { IPC } from "@nlc/shared";
import { ModelRegistry } from "@nlc/finetune";
import {
  validateCreateFinetuneJob,
  validateListEvalRuns,
  validateListFrozenSnapshots,
  validatePromoteModel,
} from "../validators.js";
import { handle } from "../ipc-handle.js";
import { FinetuneRunner, dispatchFinetuneJob } from "../finetune-runner.js";
import type { Services } from "../services.js";

export function registerFinetuneIpc(services: Services, userDataDir: string): void {
  const { storage, phase4Settings } = services;
  const finetuneRunner = new FinetuneRunner(services, userDataDir);
  // Resume queued jobs that may have been interrupted by an app restart.
  // Cheap when finetune is disabled (the runner short-circuits).
  finetuneRunner.resumeQueued();
  const registry = new ModelRegistry(storage.phase4);

  handle(IPC.listFinetuneJobs, () => storage.phase4.listFinetuneJobs());
  handle(IPC.createFinetuneJob, (raw) => {
    const { input } = validateCreateFinetuneJob(raw);
    if (!phase4Settings.get().finetuneEnabled) {
      throw new Error("Fine-tune feature is disabled in advanced settings");
    }
    // Create the job AND kick off the background training process. The IPC
    // returns immediately with the "queued" job; the runner transitions it to
    // "training" → "evaluating" or "failed" asynchronously. The UI subscribes
    // to listFinetuneJobs() to see status changes.
    return dispatchFinetuneJob(finetuneRunner, services, input);
  });
  handle(IPC.listModels, () => registry.list());
  handle(IPC.getActiveModel, () => registry.getActive());
  handle(IPC.promoteModel, (raw) => {
    const { modelId } = validatePromoteModel(raw);
    return registry.promote(modelId);
  });
  handle(IPC.rollbackToBaseModel, () => registry.rollbackToBase());

  // ----- Evals (frozen suite snapshots + eval runs are finetune-adjacent) -----
  handle(IPC.listFrozenSnapshots, (raw) => {
    const a = validateListFrozenSnapshots(raw);
    return storage.phase4.listFrozenSuiteSnapshots(a.modelId);
  });
  handle(IPC.listEvalRuns, (raw) => {
    const a = validateListEvalRuns(raw);
    return storage.phase4.listEvalRuns(a.taskId, a.modelId);
  });
}
