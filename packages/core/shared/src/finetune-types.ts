/** Fine-tune (optional) types: jobs, methods, eval results, model registry. */

export type FinetuneMethod = "lora" | "qlora";
export type FinetuneStatus =
  | "queued"
  | "training"
  | "evaluating"
  | "passed"
  | "failed"
  | "promoted"
  | "rolled_back";

export type FinetuneEvalResult = {
  baselineScore: number;
  candidateScore: number;
  delta: number;
  /** Empty when no per-task regression. Otherwise lists offending task ids. */
  perTaskRegressions: string[];
  /** General-coding holdout score (catastrophic forgetting probe). */
  holdoutScore: number;
  holdoutBaselineScore: number;
  gatePassed: boolean;
  gateReasons: string[];
};

export type FinetuneJob = {
  id: string;
  name: string;
  baseModel: string;
  datasetId: string;
  method: FinetuneMethod;
  status: FinetuneStatus;
  evalResult: FinetuneEvalResult | null;
  artifactPath: string | null;
  createdAt: number;
  updatedAt: number;
};

export type FinetuneJobInput = {
  name: string;
  baseModel: string;
  datasetId: string;
  method: FinetuneMethod;
};

export type ModelRegistryEntry = {
  id: string;
  name: string;
  kind: "base" | "lora_adapter" | "embedding_adapter";
  baseModel: string;
  /** When active, all runs use this model. Exactly one base is active by default. */
  active: boolean;
  /** Embedded eval delta vs. base for quick UI display. */
  evalDelta: number | null;
  /** Path to adapter weights (LoRA) or null for base. */
  artifactPath: string | null;
  createdAt: number;
};
