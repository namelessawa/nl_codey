/** Style-spec row converter. */

import type { StyleSpec } from "@nlc/shared";

export type StyleSpecRow = {
  id: string;
  scope: string;
  workspace_id: string | null;
  spec_json: string;
  version: number;
  updated_at: number;
};

export function toStyleSpec(r: StyleSpecRow): StyleSpec {
  const parsed = JSON.parse(r.spec_json) as Omit<StyleSpec, "version" | "updatedAt">;
  return { ...parsed, version: r.version, updatedAt: r.updated_at };
}
