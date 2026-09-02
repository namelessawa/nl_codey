/**
 * Hand-rolled runtime validators for high-risk IPC payloads. The renderer is
 * sandboxed and trusted in normal operation, but a compromised renderer (XSS
 * from a fetched HTML doc, a malicious paste, a misbehaving plugin in the
 * future) could otherwise send arbitrary shapes through and trick the main
 * process into reading attacker-controlled paths or running attacker-controlled
 * shell strings. These validators throw a readable error before the handler
 * runs; the existing `handle()` envelope turns that into `{ok:false,error}`.
 *
 * Why no zod / ajv: keeps the dependency surface small and avoids a postinstall
 * step on the Electron build. Each validator is a few lines of plain TS and the
 * shapes here are simple objects of strings/booleans/string arrays.
 */

import path from "node:path";
import { DISTRIBUTED_PRODUCTION_AVAILABLE } from "@nlc/shared";
import type {
  ContinueAgentTaskArgs,
  CreateMemoryArgs,
  DeleteMemoryArgs,
  EditTaskNodeArgs,
  FeedbackSignalInput,
  FeedbackSignalKind,
  FinetuneJobInput,
  FinetuneMethod,
  GlobalPatternInput,
  ListMemoryArgs,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryKind,
  NodeStatus,
  AdvancedSettings,
  PluginManifest,
  PluginPermission,
  ReadFileArgs,
  RunAgentTaskArgs,
  RunCommandArgs,
  RunIdArgs,
  SandboxMode,
  SetSandboxModeArgs,
  StyleCategory,
  StyleRule,
  StyleScope,
  StyleSpec,
  StyleStrength,
  TaskNodeIdArgs,
  TestLLMConnectionArgs,
  UpdateMemoryArgs,
  WorkerNode,
  WorkspaceContributionMode,
  WorkspaceIdArgs,
} from "@nlc/shared";

class IPCValidationError extends Error {
  constructor(message: string) {
    super(`IPC payload rejected: ${message}`);
    this.name = "IPCValidationError";
  }
}

/* ---------- primitive guards ---------- */

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IPCValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new IPCValidationError(`${label} must be a string`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const s = requireString(value, label);
  if (s.length === 0) throw new IPCValidationError(`${label} must not be empty`);
  return s;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new IPCValidationError(`${label} must be a boolean`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new IPCValidationError(`${label} must be an array`);
  }
  return value.map((v, i) => requireString(v, `${label}[${i}]`));
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, label);
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return requireStringArray(value, label);
}

const SANDBOX_MODES: ReadonlySet<SandboxMode> = new Set(["whitelist", "wsl", "docker"]);
const MEMORY_KINDS: ReadonlySet<MemoryKind> = new Set(["decision", "preference", "failure", "fact"]);

/**
 * `PluginPermission` is `"run_command" | "read_workspace" | "write_workspace"
 * | "read_memory" | \`network:${string}\``. A plain Set can't cover the
 * dynamic `network:<domain>` tail, so we use a prefix-based check identical
 * to the one inside the plugin-sdk's manifest validator — keep both in sync
 * when adding a permission.
 */
const KNOWN_PLUGIN_PERMISSION_TOKENS: readonly string[] = [
  "run_command",
  "read_workspace",
  "write_workspace",
  "read_memory",
];
function isKnownPluginPermission(value: string): value is PluginPermission {
  if (KNOWN_PLUGIN_PERMISSION_TOKENS.includes(value)) return true;
  // Require a non-empty host suffix; bare "network:" is meaningless and
  // would never authorize an actual request.
  return value.startsWith("network:") && value.length > "network:".length;
}

/* ---------- IPC payload validators ---------- */

export const validateRunId = (raw: unknown): RunIdArgs => {
  const r = requireRecord(raw, "args");
  return { runId: requireNonEmptyString(r.runId, "runId") };
};

export const validateWorkspaceId = (raw: unknown): WorkspaceIdArgs => {
  const r = requireRecord(raw, "args");
  return { workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId") };
};

export const validateRunAgentTask = (raw: unknown): RunAgentTaskArgs => {
  const r = requireRecord(raw, "args");
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    task: requireString(r.task, "task"),
  };
};

export const validateContinueAgentTask = (raw: unknown): ContinueAgentTaskArgs => {
  const r = requireRecord(raw, "args");
  return {
    runId: requireNonEmptyString(r.runId, "runId"),
    followUp: requireString(r.followUp, "followUp"),
  };
};

export const validateRunCommand = (raw: unknown): RunCommandArgs => {
  const r = requireRecord(raw, "args");
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    command: requireNonEmptyString(r.command, "command"),
  };
};

export const validateReadFile = (raw: unknown): ReadFileArgs => {
  const r = requireRecord(raw, "args");
  // `path` is treated as workspace-relative by readFileTool; the sandbox
  // package re-validates it stays under the workspace root, so we only need
  // a shape check here. Absolute paths and `..` are rejected downstream.
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    path: requireNonEmptyString(r.path, "path"),
  };
};

export const validateTestLLMConnection = (raw: unknown): TestLLMConnectionArgs => {
  const r = requireRecord(raw, "args");
  const cfg = requireRecord(r.config, "args.config");
  return {
    config: {
      provider: requireString(cfg.provider, "config.provider") as TestLLMConnectionArgs["config"]["provider"],
      apiKey: requireString(cfg.apiKey, "config.apiKey"),
      baseUrl: requireString(cfg.baseUrl, "config.baseUrl"),
      model: requireString(cfg.model, "config.model"),
      temperature: requireNumber(cfg.temperature, "config.temperature"),
      maxTokens: requireNumber(cfg.maxTokens, "config.maxTokens"),
      timeoutSeconds: requireNumber(cfg.timeoutSeconds, "config.timeoutSeconds"),
    },
  };
};

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IPCValidationError(`${label} must be a finite number`);
  }
  return value;
}

function requireNumberInRange(value: unknown, label: string, min: number, max: number): number {
  const n = requireNumber(value, label);
  if (n < min || n > max) {
    throw new IPCValidationError(`${label} must be in [${min}, ${max}]; got ${n}`);
  }
  return n;
}

function requireIntegerInRange(value: unknown, label: string, min: number, max: number): number {
  const n = requireNumberInRange(value, label, min, max);
  if (!Number.isInteger(n)) {
    throw new IPCValidationError(`${label} must be an integer; got ${n}`);
  }
  return n;
}

function requireNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new IPCValidationError(`${label} must be an array`);
  }
  return value.map((v, i) => requireNumber(v, `${label}[${i}]`));
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (value === undefined) return null; // tolerate both for cross-serializer safety
  return requireString(value, label);
}

function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlySet<T> | readonly T[],
): T {
  const s = requireString(value, label);
  const set = allowed instanceof Set ? allowed : new Set<T>(allowed);
  if (!set.has(s as T)) {
    throw new IPCValidationError(
      `${label} must be one of: ${[...set].join(", ")}; got "${s}"`,
    );
  }
  return s as T;
}

function requireIdArg<F extends string>(raw: unknown, idField: F): Record<F, string> {
  const r = requireRecord(raw, "args");
  return { [idField]: requireNonEmptyString(r[idField], idField) } as Record<F, string>;
}

/* ---------- Phase 3 ---------- */

export const validateListMemory = (raw: unknown): ListMemoryArgs => {
  const r = requireRecord(raw, "args");
  const out: ListMemoryArgs = {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
  };
  if (r.filter !== undefined && r.filter !== null) {
    const f = requireRecord(r.filter, "filter");
    const filter: ListMemoryArgs["filter"] = {};
    const kind = optionalString(f.kind, "filter.kind");
    if (kind !== undefined) {
      if (!MEMORY_KINDS.has(kind as MemoryKind)) {
        throw new IPCValidationError(`filter.kind must be one of: ${[...MEMORY_KINDS].join(", ")}`);
      }
      filter.kind = kind as MemoryKind;
    }
    const search = optionalString(f.search, "filter.search");
    if (search !== undefined) filter.search = search;
    if (f.includeHidden !== undefined) {
      filter.includeHidden = requireBoolean(f.includeHidden, "filter.includeHidden");
    }
    const tags = optionalStringArray(f.tags, "filter.tags");
    if (tags !== undefined) filter.tags = tags;
    out.filter = filter;
  }
  return out;
};

function validateMemoryEntryInput(raw: unknown): MemoryEntryInput {
  const e = requireRecord(raw, "entry");
  const kind = requireString(e.kind, "entry.kind");
  if (!MEMORY_KINDS.has(kind as MemoryKind)) {
    throw new IPCValidationError(`entry.kind must be one of: ${[...MEMORY_KINDS].join(", ")}`);
  }
  const out: MemoryEntryInput = {
    kind: kind as MemoryKind,
    title: requireNonEmptyString(e.title, "entry.title"),
    body: requireString(e.body, "entry.body"),
  };
  const tags = optionalStringArray(e.tags, "entry.tags");
  if (tags !== undefined) out.tags = tags;
  const sourceRunId = optionalString(e.sourceRunId, "entry.sourceRunId");
  if (sourceRunId !== undefined) out.sourceRunId = sourceRunId;
  return out;
}

export const validateCreateMemory = (raw: unknown): CreateMemoryArgs => {
  const r = requireRecord(raw, "args");
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    entry: validateMemoryEntryInput(r.entry),
  };
};

export const validateUpdateMemory = (raw: unknown): UpdateMemoryArgs => {
  const r = requireRecord(raw, "args");
  const patchRaw = requireRecord(r.patch, "patch");
  const patch: MemoryEntryPatch = {};
  if (patchRaw.title !== undefined) patch.title = requireString(patchRaw.title, "patch.title");
  if (patchRaw.body !== undefined) patch.body = requireString(patchRaw.body, "patch.body");
  if (patchRaw.kind !== undefined) {
    const k = requireString(patchRaw.kind, "patch.kind");
    if (!MEMORY_KINDS.has(k as MemoryKind)) {
      throw new IPCValidationError(`patch.kind must be one of: ${[...MEMORY_KINDS].join(", ")}`);
    }
    patch.kind = k as MemoryKind;
  }
  if (patchRaw.tags !== undefined) patch.tags = requireStringArray(patchRaw.tags, "patch.tags");
  if (patchRaw.usefulness !== undefined) {
    patch.usefulness = requireNumber(patchRaw.usefulness, "patch.usefulness");
  }
  return { id: requireNonEmptyString(r.id, "id"), patch };
};

export const validateDeleteMemory = (raw: unknown): DeleteMemoryArgs => {
  const r = requireRecord(raw, "args");
  return { id: requireNonEmptyString(r.id, "id") };
};

export const validateSetSandboxMode = (raw: unknown): SetSandboxModeArgs => {
  const r = requireRecord(raw, "args");
  const mode = requireString(r.mode, "mode");
  if (!SANDBOX_MODES.has(mode as SandboxMode)) {
    throw new IPCValidationError(`mode must be one of: ${[...SANDBOX_MODES].join(", ")}`);
  }
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    mode: mode as SandboxMode,
  };
};

export const validateEditTaskNode = (raw: unknown): EditTaskNodeArgs => {
  const r = requireRecord(raw, "args");
  const p = requireRecord(r.patch, "patch");
  return {
    taskNodeId: requireNonEmptyString(r.taskNodeId, "taskNodeId"),
    patch: p as EditTaskNodeArgs["patch"],
  };
};

export const validateTaskNodeId = (raw: unknown): TaskNodeIdArgs => {
  const r = requireRecord(raw, "args");
  return { taskNodeId: requireNonEmptyString(r.taskNodeId, "taskNodeId") };
};

/* ---------- Phase 4 plugin install ---------- */

/**
 * Validate a {@link PluginManifest} shape AND each requested permission
 * string. The full semantic validation (semver, snake_case tool names) lives
 * in {@link import("@nlc/plugin-sdk").validateManifest}; this
 * function only ensures the IPC payload is well-formed enough to hand off.
 */
export function validateInstallPlugin(raw: unknown): {
  manifest: PluginManifest;
  installPath: string;
  approvedPermissions: PluginPermission[];
} {
  const r = requireRecord(raw, "args");
  const m = requireRecord(r.manifest, "manifest");
  const permsRaw = requireStringArray(r.approvedPermissions, "approvedPermissions");
  for (const p of permsRaw) {
    if (!isKnownPluginPermission(p)) {
      throw new IPCValidationError(
        `approvedPermissions contains unknown permission "${p}"; expected one of run_command, read_workspace, write_workspace, read_memory, or network:<domain>`,
      );
    }
  }
  // We trust the SDK to do the deep manifest validation — just confirm the
  // required top-level fields are present so the SDK gets a complete payload.
  return {
    manifest: {
      ...(m as object),
      name: requireNonEmptyString(m.name, "manifest.name"),
      version: requireNonEmptyString(m.version, "manifest.version"),
    } as PluginManifest,
    installPath: requireAbsolutePath(r.installPath, "installPath"),
    approvedPermissions: permsRaw as PluginPermission[],
  };
}

/**
 * Reject a path that isn't absolute or that contains `..` segments after
 * normalisation. Plugin installation paths are concatenated into the
 * shell-rendered command via `node "<installPath>/tools/<name>.js"` — a
 * relative or `..`-laden path would let a malicious manifest direct the
 * spawn at an attacker-chosen file outside the install directory.
 */
function requireAbsolutePath(value: unknown, label: string): string {
  const raw = requireNonEmptyString(value, label);
  if (!path.isAbsolute(raw)) {
    throw new IPCValidationError(`${label} must be an absolute path; got "${raw}"`);
  }
  const normalized = path.normalize(raw);
  if (normalized.split(path.sep).includes("..")) {
    throw new IPCValidationError(
      `${label} must not contain ".." segments after normalisation; got "${raw}"`,
    );
  }
  return normalized;
}

/* ---------- Phase 4 enum sets ---------- */

const WORKSPACE_CONTRIBUTION_MODES: ReadonlySet<WorkspaceContributionMode> = new Set([
  "isolated",
  "contribute",
  "team_shared",
]);
const STYLE_SCOPES: ReadonlySet<StyleScope> = new Set(["global", "team", "project"]);
const STYLE_CATEGORIES: ReadonlySet<StyleCategory> = new Set([
  "naming",
  "error-handling",
  "imports",
  "testing",
  "comments",
  "structure",
]);
const STYLE_STRENGTHS: ReadonlySet<StyleStrength> = new Set(["must", "should", "prefer"]);
const STYLE_SOURCES: ReadonlySet<StyleRule["source"]> = new Set([
  "extracted",
  "feedback",
  "manual",
]);
const FEEDBACK_SIGNAL_KINDS: ReadonlySet<FeedbackSignalKind> = new Set([
  "diff_accepted",
  "diff_rejected",
  "diff_edited",
  "review_overturned",
  "manual_correction",
]);
const FINETUNE_METHODS: ReadonlySet<FinetuneMethod> = new Set(["lora", "qlora"]);
const NODE_STATUSES: ReadonlySet<NodeStatus> = new Set([
  "online",
  "busy",
  "offline",
  "degraded",
]);

/* ---------- Phase 4 ---------- */

/**
 * Validate {@link GlobalPatternInput}. Limits string lengths defensively
 * (titles/descriptions are persisted to SQLite + read into prompt
 * augmentations — unbounded sizes would either crash storage or balloon
 * subsequent LLM calls). Embedding length is capped at 4096 dimensions which
 * is generous for every embedder we ship.
 */
export function validateContributeGlobalPattern(raw: unknown): { input: GlobalPatternInput } {
  const r = requireRecord(raw, "args");
  const input = requireRecord(r.input, "input");
  const title = requireNonEmptyString(input.title, "input.title");
  if (title.length > 200) throw new IPCValidationError("input.title is too long (max 200 chars)");
  const description = requireString(input.description, "input.description");
  if (description.length > 8000)
    throw new IPCValidationError("input.description is too long (max 8000 chars)");
  const exampleSnippet = requireString(input.exampleSnippet, "input.exampleSnippet");
  if (exampleSnippet.length > 8000)
    throw new IPCValidationError("input.exampleSnippet is too long (max 8000 chars)");
  const sourceProjects = requireStringArray(input.sourceProjects, "input.sourceProjects");
  if (sourceProjects.length > 1000)
    throw new IPCValidationError("input.sourceProjects has too many entries (max 1000)");
  const tags = requireStringArray(input.tags, "input.tags");
  if (tags.length > 100)
    throw new IPCValidationError("input.tags has too many entries (max 100)");
  const confidence = requireNumberInRange(input.confidence, "input.confidence", 0, 1);
  const embedding = requireNumberArray(input.embedding, "input.embedding");
  if (embedding.length > 4096)
    throw new IPCValidationError("input.embedding has too many dimensions (max 4096)");
  return {
    input: { title, description, exampleSnippet, sourceProjects, tags, confidence, embedding },
  };
}

export function validateDeleteGlobalPattern(raw: unknown): { id: string } {
  return requireIdArg(raw, "id");
}

export function validateSetWorkspaceContribution(raw: unknown): {
  workspaceId: string;
  mode: WorkspaceContributionMode;
} {
  const r = requireRecord(raw, "args");
  return {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
    mode: requireEnum(r.mode, "mode", WORKSPACE_CONTRIBUTION_MODES),
  };
}

export function validateGetStyleSpec(raw: unknown): {
  scope: StyleScope;
  workspaceId: string | null;
} {
  const r = requireRecord(raw, "args");
  return {
    scope: requireEnum(r.scope, "scope", STYLE_SCOPES),
    workspaceId: nullableString(r.workspaceId, "workspaceId"),
  };
}

function validateStyleRule(raw: unknown, label: string): StyleRule {
  const e = requireRecord(raw, label);
  const examplesRaw = e.examples;
  if (!Array.isArray(examplesRaw))
    throw new IPCValidationError(`${label}.examples must be an array`);
  if (examplesRaw.length > 50)
    throw new IPCValidationError(`${label}.examples has too many entries (max 50)`);
  const examples = examplesRaw.map((x, i) => {
    const ex = requireRecord(x, `${label}.examples[${i}]`);
    return {
      good: requireString(ex.good, `${label}.examples[${i}].good`),
      bad: requireString(ex.bad, `${label}.examples[${i}].bad`),
    };
  });
  return {
    id: requireNonEmptyString(e.id, `${label}.id`),
    category: requireEnum(e.category, `${label}.category`, STYLE_CATEGORIES),
    rule: requireString(e.rule, `${label}.rule`),
    examples,
    strength: requireEnum(e.strength, `${label}.strength`, STYLE_STRENGTHS),
    confidence: requireNumberInRange(e.confidence, `${label}.confidence`, 0, 1),
    signalCount: requireNumber(e.signalCount, `${label}.signalCount`),
    source: requireEnum(e.source, `${label}.source`, STYLE_SOURCES),
    createdAt: requireNumber(e.createdAt, `${label}.createdAt`),
    updatedAt: requireNumber(e.updatedAt, `${label}.updatedAt`),
  };
}

export function validateUpsertStyleSpec(raw: unknown): { spec: StyleSpec } {
  const r = requireRecord(raw, "args");
  const s = requireRecord(r.spec, "spec");
  const rulesRaw = s.rules;
  if (!Array.isArray(rulesRaw)) throw new IPCValidationError("spec.rules must be an array");
  if (rulesRaw.length > 1000)
    throw new IPCValidationError("spec.rules has too many entries (max 1000)");
  const rules = rulesRaw.map((r2, i) => validateStyleRule(r2, `spec.rules[${i}]`));
  const derived = requireRecord(s.derivedFrom, "spec.derivedFrom");
  const stats = requireRecord(derived.codebaseStats, "spec.derivedFrom.codebaseStats");
  // Stats values are typed as `number | string`; shallow-check.
  const codebaseStats: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v !== "number" && typeof v !== "string") {
      throw new IPCValidationError(
        `spec.derivedFrom.codebaseStats[${k}] must be number or string`,
      );
    }
    codebaseStats[k] = v;
  }
  return {
    spec: {
      scope: requireEnum(s.scope, "spec.scope", STYLE_SCOPES),
      workspaceId: nullableString(s.workspaceId, "spec.workspaceId"),
      rules,
      derivedFrom: {
        codebaseStats,
        acceptedDiffs: requireNumber(derived.acceptedDiffs, "spec.derivedFrom.acceptedDiffs"),
        rejectedDiffs: requireNumber(derived.rejectedDiffs, "spec.derivedFrom.rejectedDiffs"),
      },
      version: requireNumber(s.version, "spec.version"),
      updatedAt: requireNumber(s.updatedAt, "spec.updatedAt"),
    },
  };
}

export function validateRecordFeedbackSignal(raw: unknown): { signal: FeedbackSignalInput } {
  const r = requireRecord(raw, "args");
  const s = requireRecord(r.signal, "signal");
  const before = requireString(s.before, "signal.before");
  if (before.length > 200_000)
    throw new IPCValidationError("signal.before is too long (max 200000 chars)");
  const after = nullableString(s.after, "signal.after");
  if (after !== null && after.length > 200_000)
    throw new IPCValidationError("signal.after is too long (max 200000 chars)");
  return {
    signal: {
      workspaceId: requireNonEmptyString(s.workspaceId, "signal.workspaceId"),
      runId: requireNonEmptyString(s.runId, "signal.runId"),
      taskNodeId: nullableString(s.taskNodeId, "signal.taskNodeId"),
      kind: requireEnum(s.kind, "signal.kind", FEEDBACK_SIGNAL_KINDS),
      before,
      after,
      reason: nullableString(s.reason, "signal.reason"),
      filePath: nullableString(s.filePath, "signal.filePath"),
    },
  };
}

export function validateBuildPreferenceDataset(raw: unknown): {
  workspaceId: string;
  name?: string;
} {
  const r = requireRecord(raw, "args");
  const out: { workspaceId: string; name?: string } = {
    workspaceId: requireNonEmptyString(r.workspaceId, "workspaceId"),
  };
  const name = optionalString(r.name, "name");
  if (name !== undefined) out.name = name;
  return out;
}

export function validateCreateFinetuneJob(raw: unknown): { input: FinetuneJobInput } {
  const r = requireRecord(raw, "args");
  const i = requireRecord(r.input, "input");
  const name = requireNonEmptyString(i.name, "input.name");
  if (name.length > 200)
    throw new IPCValidationError("input.name is too long (max 200 chars)");
  return {
    input: {
      name,
      baseModel: requireNonEmptyString(i.baseModel, "input.baseModel"),
      datasetId: requireNonEmptyString(i.datasetId, "input.datasetId"),
      method: requireEnum(i.method, "input.method", FINETUNE_METHODS),
    },
  };
}

export function validatePromoteModel(raw: unknown): { modelId: string } {
  return requireIdArg(raw, "modelId");
}

export function validateSnoozeProposal(raw: unknown): { id: string; untilTs: number } {
  const r = requireRecord(raw, "args");
  return {
    id: requireNonEmptyString(r.id, "id"),
    untilTs: requireNumber(r.untilTs, "untilTs"),
  };
}

export function validateProposalId(raw: unknown): { id: string } {
  return requireIdArg(raw, "id");
}

export function validateRegisterWorkerNode(raw: unknown): {
  node: Omit<WorkerNode, "registeredAt">;
} {
  const r = requireRecord(raw, "args");
  const n = requireRecord(r.node, "node");
  const endpoint = requireNonEmptyString(n.endpoint, "node.endpoint");
  // Endpoints get embedded into background dispatch URLs; reject anything that
  // isn't http(s) so a renderer can't redirect worker traffic to file:// or a
  // custom protocol later. Length cap defends against absurd URL bombs.
  if (endpoint.length > 2048)
    throw new IPCValidationError("node.endpoint is too long (max 2048 chars)");
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new IPCValidationError(`node.endpoint must use http(s); got "${url.protocol}"`);
    }
  } catch (e) {
    if (e instanceof IPCValidationError) throw e;
    throw new IPCValidationError(`node.endpoint is not a valid URL: "${endpoint}"`);
  }
  return {
    node: {
      id: requireNonEmptyString(n.id, "node.id"),
      hostname: requireNonEmptyString(n.hostname, "node.hostname"),
      endpoint,
      status: requireEnum(n.status, "node.status", NODE_STATUSES),
      activeAssignments: requireStringArray(n.activeAssignments, "node.activeAssignments"),
      capabilities: requireStringArray(n.capabilities, "node.capabilities"),
      lastHeartbeat: requireNumber(n.lastHeartbeat, "node.lastHeartbeat"),
    },
  };
}

export function validateSetPluginEnabled(raw: unknown): { id: string; enabled: boolean } {
  const r = requireRecord(raw, "args");
  return {
    id: requireNonEmptyString(r.id, "id"),
    enabled: requireBoolean(r.enabled, "enabled"),
  };
}

export function validatePluginId(raw: unknown): { id: string } {
  return requireIdArg(raw, "id");
}

export function validateListFrozenSnapshots(raw: unknown): { modelId?: string } {
  if (raw === undefined || raw === null) return {};
  const r = requireRecord(raw, "args");
  const out: { modelId?: string } = {};
  const modelId = optionalString(r.modelId, "modelId");
  if (modelId !== undefined) out.modelId = modelId;
  return out;
}

export function validateListEvalRuns(raw: unknown): { taskId?: string; modelId?: string } {
  if (raw === undefined || raw === null) return {};
  const r = requireRecord(raw, "args");
  const out: { taskId?: string; modelId?: string } = {};
  const taskId = optionalString(r.taskId, "taskId");
  if (taskId !== undefined) out.taskId = taskId;
  const modelId = optionalString(r.modelId, "modelId");
  if (modelId !== undefined) out.modelId = modelId;
  return out;
}

export function validateUpdateAdvancedSettings(raw: unknown): { settings: AdvancedSettings } {
  const r = requireRecord(raw, "args");
  const s = requireRecord(r.settings, "settings");
  const distributedEnabled = requireBoolean(
    s.distributedEnabled,
    "settings.distributedEnabled",
  );
  if (distributedEnabled && !DISTRIBUTED_PRODUCTION_AVAILABLE) {
    throw new IPCValidationError(
      "distributed execution is unavailable until an authenticated transport exists",
    );
  }
  return {
    settings: {
      globalMemoryEnabled: requireBoolean(s.globalMemoryEnabled, "settings.globalMemoryEnabled"),
      styleProfileEnabled: requireBoolean(s.styleProfileEnabled, "settings.styleProfileEnabled"),
      learningEnabled: requireBoolean(s.learningEnabled, "settings.learningEnabled"),
      finetuneEnabled: requireBoolean(s.finetuneEnabled, "settings.finetuneEnabled"),
      distributedEnabled: false,
      proactiveEnabled: requireBoolean(s.proactiveEnabled, "settings.proactiveEnabled"),
      pluginsEnabled: requireBoolean(s.pluginsEnabled, "settings.pluginsEnabled"),
      contributionMode: requireEnum(
        s.contributionMode,
        "settings.contributionMode",
        WORKSPACE_CONTRIBUTION_MODES,
      ),
      // Schedule cadence: keep in sync with the [1, 1440] clamp inside
      // startProactiveScheduler so the UI and runtime agree.
      proactiveScanIntervalMin: requireIntegerInRange(
        s.proactiveScanIntervalMin,
        "settings.proactiveScanIntervalMin",
        1,
        1440,
      ),
    },
  };
}
