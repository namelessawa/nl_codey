# Verified P0 hardening result — 2026-07-28

## Outcome

Dynamic tool registration and dispatch now fail closed on the clean
`origin/main` lineage. Invalid bundles never expose schemas or retain their
source dispatcher. Security denials and factory failures are visible in the
run audit trail, and Desktop no longer hides plugin construction failures.

## Before

- `mutatingNames` was optional; missing classification was treated as
  non-mutating.
- Bundles were not runtime-validated for classification integrity, duplicate
  schemas, or built-in name collisions.
- A fabricated, unadvertised dynamic name could still reach the source
  dispatcher.
- AgentService silently converted dynamic factory exceptions to `null`.
- Desktop caught `buildPluginBundle` exceptions first and also returned
  `null`, preventing any run-level security audit record.

## After

- `mutatingNames` is mandatory, including `[]` for a fully read-only bundle.
- Runtime validation rejects missing/non-array classification, unknown or
  duplicate mutating names, invalid/duplicate schemas, and collisions with
  every built-in tool surface.
- The validated dispatcher refuses undeclared dynamic calls.
- Read-only mode removes mutating schemas and rejects fabricated calls.
- Degraded mode rejects classified mutating calls before source dispatch.
- Single-agent and multi-agent paths share one audited resolver.
- Factory or validation failure adds an error Step prefixed `[security]`.
- Desktop propagates `buildPluginBundle` exceptions to that resolver.

## Compatibility change

Every dynamic bundle producer must now return `mutatingNames`. Producers that
previously omitted it, returned a non-array value, duplicated names/schemas, or
used a built-in tool name are disabled as a whole. This is intentional
fail-closed behavior.

## Verification summary

- Install: passed.
- Agent Core typecheck: passed.
- Agent Core tests: 17 files passed; 142 tests passed; 12 skipped.
- Full typecheck: passed.
- Full tests: command failed only on four
  `packages/core/storage/src/storage.test.ts` cases due Electron ABI 130 versus
  Node ABI 137; 83 other files and 686 tests passed.
- Production build: passed.

See [baseline.md](baseline.md) for exact commands and
[feature-reality-matrix.md](feature-reality-matrix.md) for traceable evidence.

## Change isolation

The code changes are limited to:

- `packages/runtime/agent-core/src/service.ts`;
- `packages/runtime/agent-core/src/dynamic-tools-security.test.ts`;
- `apps/desktop/src/main/services.ts`;
- `apps/desktop/src/main/services.test.ts`.

Documentation is limited to `README.md`, `AGENTS.md`, `CHANGELOG.md`, and this
audit directory. The preserved mixed branch was not merged or cherry-picked.

## Known unresolved security risk

This fix cannot isolate a complete Node plugin process. Once such a process is
started under the host user, direct Node filesystem/network/process APIs are
outside the bundle registration and dispatcher checks. OS-enforced plugin
isolation requires a separate restricted runner and is not implemented here.
