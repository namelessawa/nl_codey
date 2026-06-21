/** Finetune row converters: jobs + model registry. */

import type {
  FinetuneEvalResult,
  FinetuneJob,
  ModelRegistryEntry,
} from "@nlc/shared";

export type FinetuneJobRow = {
  id: string;
  name: string;
  base_model: string;
  dataset_id: string;
  method: string;
  status: string;
  eval_result_json: string | null;
  artifact_path: string | null;
  created_at: number;
  updated_at: number;
};

export function toFinetuneJob(r: FinetuneJobRow): FinetuneJob {
  return {
    id: r.id,
    name: r.name,
    baseModel: r.base_model,
    datasetId: r.dataset_id,
    method: r.method as FinetuneJob["method"],
    status: r.status as FinetuneJob["status"],
    evalResult: r.eval_result_json
      ? (JSON.parse(r.eval_result_json) as FinetuneEvalResult)
      : null,
    artifactPath: r.artifact_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type ModelRegistryRow = {
  id: string;
  name: string;
  kind: string;
  base_model: string;
  active: number;
  eval_delta: number | null;
  artifact_path: string | null;
  created_at: number;
};

export function toModelRegistryEntry(r: ModelRegistryRow): ModelRegistryEntry {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ModelRegistryEntry["kind"],
    baseModel: r.base_model,
    active: r.active === 1,
    evalDelta: r.eval_delta,
    artifactPath: r.artifact_path,
    createdAt: r.created_at,
  };
}
