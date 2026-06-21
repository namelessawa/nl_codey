/**
 * Plugin manifest validator. A plugin that fails validation is REJECTED at
 * install time — it cannot reach the runtime. We never trust a manifest's
 * permission list at runtime either: every tool invocation re-checks against
 * the user's approved set.
 */
import type {
  PluginManifest,
  PluginPermission,
  PluginToolManifest,
  PluginToolParameter,
} from "@nlc/shared";

export type ValidationIssue = { path: string; message: string };
export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ValidationIssue[] };

const ALLOWED_SANDBOXES = new Set(["whitelist", "wsl", "docker"]);
// The four fixed permissions are exact-match only. `network:` is the sole
// prefix form because the host suffix is free-form (e.g. `network:api.example.com`).
// Previously every entry was matched with startsWith, so garbage strings like
// `run_command_extra`, `read_workspace_anything`, or `read_memory_dump` all
// passed validation and got persisted in installed manifests — the
// host-side authorize() then exact-matched them and never granted anything,
// silently breaking the plugin while polluting the permission model.
const FIXED_PERMISSIONS = new Set<string>([
  "run_command",
  "read_workspace",
  "write_workspace",
  "read_memory",
]);
const NETWORK_PREFIX = "network:";

export function validateManifest(input: unknown): ManifestValidationResult {
  const issues: ValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, issues: [{ path: "$", message: "manifest must be an object" }] };
  }
  const m = input as Record<string, unknown>;
  if (typeof m.name !== "string" || !m.name.trim()) {
    issues.push({ path: "name", message: "name is required" });
  }
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) {
    issues.push({ path: "version", message: "version must follow semver (x.y.z)" });
  }
  if (typeof m.sandbox !== "string" || !ALLOWED_SANDBOXES.has(m.sandbox)) {
    issues.push({ path: "sandbox", message: `sandbox must be one of ${[...ALLOWED_SANDBOXES].join(", ")}` });
  }
  if (!Array.isArray(m.tools) || m.tools.length === 0) {
    issues.push({ path: "tools", message: "at least one tool required" });
  } else {
    m.tools.forEach((tool, idx) => {
      validateTool(tool, `tools[${idx}]`, issues);
    });
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: m as unknown as PluginManifest };
}

function validateTool(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!input || typeof input !== "object") {
    issues.push({ path, message: "tool must be an object" });
    return;
  }
  const t = input as Record<string, unknown>;
  if (typeof t.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(t.name)) {
    issues.push({ path: `${path}.name`, message: "tool name must be snake_case" });
  }
  if (typeof t.description !== "string" || !t.description) {
    issues.push({ path: `${path}.description`, message: "description is required" });
  }
  if (!t.parameters || typeof t.parameters !== "object") {
    issues.push({ path: `${path}.parameters`, message: "parameters must be an object" });
  } else {
    for (const [key, paramRaw] of Object.entries(t.parameters as Record<string, unknown>)) {
      validateParameter(paramRaw, `${path}.parameters.${key}`, issues);
    }
  }
  if (!Array.isArray(t.permissions)) {
    issues.push({ path: `${path}.permissions`, message: "permissions array required (may be empty)" });
  } else {
    t.permissions.forEach((perm, idx) => {
      if (!isKnownPermission(perm)) {
        issues.push({
          path: `${path}.permissions[${idx}]`,
          message: `unknown permission '${String(perm)}'`,
        });
      }
    });
  }
}

function validateParameter(input: unknown, path: string, issues: ValidationIssue[]): void {
  if (!input || typeof input !== "object") {
    issues.push({ path, message: "parameter must be an object" });
    return;
  }
  const p = input as Record<string, unknown>;
  if (p.type !== "string" && p.type !== "number" && p.type !== "boolean") {
    issues.push({ path: `${path}.type`, message: "type must be string|number|boolean" });
  }
}

function isKnownPermission(value: unknown): value is PluginPermission {
  if (typeof value !== "string") return false;
  if (FIXED_PERMISSIONS.has(value)) return true;
  // network: requires a non-empty host suffix. Bare `network:` is meaningless
  // and would never authorize an actual request, so reject it at validation.
  if (value.startsWith(NETWORK_PREFIX) && value.length > NETWORK_PREFIX.length) {
    return true;
  }
  return false;
}

export type AuthorizationOutcome =
  | { allowed: true; matched: PluginPermission }
  | { allowed: false; reason: string };

/**
 * Check whether an invocation of `requested` permission is covered by the
 * `approved` set. Network permissions are scoped to a domain — exact match.
 */
export function authorize(
  requested: PluginPermission,
  approved: PluginPermission[],
): AuthorizationOutcome {
  if (approved.includes(requested)) return { allowed: true, matched: requested };
  return { allowed: false, reason: `permission ${requested} not approved by user` };
}

/** Re-export the manifest types for plugin authors. */
export type { PluginManifest, PluginPermission, PluginToolManifest, PluginToolParameter };
