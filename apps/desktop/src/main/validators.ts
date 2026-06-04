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

import type {
  ContinueAgentTaskArgs,
  CreateMemoryArgs,
  DeleteMemoryArgs,
  EditTaskNodeArgs,
  ListMemoryArgs,
  MemoryEntryInput,
  MemoryEntryPatch,
  MemoryKind,
  PluginManifest,
  PluginPermission,
  ReadFileArgs,
  RunAgentTaskArgs,
  RunCommandArgs,
  RunIdArgs,
  SandboxMode,
  SetSandboxModeArgs,
  TaskNodeIdArgs,
  TestLLMConnectionArgs,
  UpdateMemoryArgs,
  WorkspaceIdArgs,
} from "@coding-agent/shared";

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
  return value.startsWith("network:");
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
 * in {@link import("@coding-agent/plugin-sdk").validateManifest}; this
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
    installPath: requireNonEmptyString(r.installPath, "installPath"),
    approvedPermissions: permsRaw as PluginPermission[],
  };
}
