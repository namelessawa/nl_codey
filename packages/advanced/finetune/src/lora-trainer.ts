/**
 * LoRA / QLoRA trainer orchestrator. This is an OPT-IN, DEFAULT-OFF module —
 * its job is to drive an external training process (a Python script bundled
 * with the app) and wire its lifecycle into the job-tracking storage.
 *
 * **The trainer NEVER promotes a model on its own.** All promotion paths go
 * through {@link EvalGate.evaluate} → user confirmation → ModelRegistry.
 */
import type {
  FinetuneJob,
  FinetuneJobInput,
  FinetuneMethod,
  FinetuneStatus,
} from "@nlc/shared";

export interface FinetuneStore {
  createFinetuneJob(input: FinetuneJobInput): FinetuneJob;
  getFinetuneJob(id: string): FinetuneJob | null;
  listFinetuneJobs(): FinetuneJob[];
  updateFinetuneJob(
    id: string,
    patch: {
      status?: FinetuneStatus;
      evalResult?: FinetuneJob["evalResult"];
      artifactPath?: string | null;
    },
  ): FinetuneJob | null;
}

export type TrainerProcess = {
  /** Resolves with the path to the produced adapter artifact. */
  promise: Promise<{ artifactPath: string }>;
  /** Cancellation: the caller may abort an in-progress job. */
  abort(): void;
};

/**
 * Adapter contract for the actual training backend. In production this would
 * shell out to a Python LoRA script. In tests this is mocked.
 */
export interface TrainerBackend {
  start(args: {
    baseModel: string;
    datasetId: string;
    method: FinetuneMethod;
    onProgress?: (line: string) => void;
  }): TrainerProcess;
}

export class LoRATrainer {
  constructor(
    private readonly store: FinetuneStore,
    private readonly backend: TrainerBackend,
  ) {}

  async runJob(input: FinetuneJobInput): Promise<FinetuneJob> {
    const job = this.store.createFinetuneJob(input);
    this.store.updateFinetuneJob(job.id, { status: "training" });
    try {
      const process = this.backend.start({
        baseModel: input.baseModel,
        datasetId: input.datasetId,
        method: input.method,
      });
      const { artifactPath } = await process.promise;
      const next = this.store.updateFinetuneJob(job.id, {
        status: "evaluating",
        artifactPath,
      });
      return next ?? job;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const next = this.store.updateFinetuneJob(job.id, {
        status: "failed",
        evalResult: {
          baselineScore: 0,
          candidateScore: 0,
          delta: 0,
          perTaskRegressions: [],
          holdoutScore: 0,
          holdoutBaselineScore: 0,
          gatePassed: false,
          gateReasons: [`Training failed: ${reason}`],
        },
      });
      return next ?? job;
    }
  }

  list(): FinetuneJob[] {
    return this.store.listFinetuneJobs();
  }

  get(id: string): FinetuneJob | null {
    return this.store.getFinetuneJob(id);
  }
}
