# Verified P0 hardening result — 2026-07-28

## Outcome

Dynamic tool registration and dispatch now fail closed on the clean
`origin/main` lineage. Invalid bundles never expose schemas or retain their
source dispatcher. Security denials and factory failures are visible in the
run audit trail, Multi-Agent roles cannot bypass their advertised schemas, and
Desktop no longer hides plugin construction failures.

## Before

- `mutatingNames` was optional; missing classification was treated as
  non-mutating.
- Bundles were not runtime-validated for classification integrity, duplicate
  schemas, or built-in name collisions.
- A fabricated, unadvertised dynamic name could still reach the source
  dispatcher.
- Planner, Coder, and Reviewer filtered schemas but forwarded fabricated
  out-of-role calls to the shared executor.
- The collision set omitted host-owned names such as `write_file`.
- AgentService silently converted dynamic factory exceptions to `null`.
- Factory exception text was persisted and emitted without security-specific
  redaction or normalization.
- Desktop caught `buildPluginBundle` exceptions first and also returned
  `null`, preventing any run-level security audit record.

## After

- `mutatingNames` is mandatory, including `[]` for a fully read-only bundle.
- Runtime validation rejects missing/non-array classification, unknown or
  duplicate mutating names, invalid/duplicate schemas, and collisions with
  every host-reserved tool surface, including `write_file`.
- The validated dispatcher refuses undeclared dynamic calls.
- Planner, Coder, and Reviewer build `allowedToolNames` from the exact schemas
  exposed to that role and reject other calls before the shared executor.
  Dynamic tools are assigned to no Multi-Agent role by default.
- Read-only mode removes mutating schemas and rejects fabricated calls.
- Degraded mode rejects classified mutating calls before source dispatch.
- Single-agent and multi-agent paths share one audited resolver.
- Factory or validation failure adds an error Step prefixed `[security]`;
  factory details are bounded, normalized, and redacted for credentials,
  sensitive URL material, and the local user directory.
- Desktop propagates `buildPluginBundle` exceptions to that resolver.

## Compatibility change

Every dynamic bundle producer must now return `mutatingNames`. Producers that
previously omitted it, returned a non-array value, duplicated names/schemas, or
used a built-in tool name are disabled as a whole. This is intentional
fail-closed behavior.

## Verification results

### Local

- Agent Core typecheck passed.
- Agent Core tests passed: 17 files, 153 tests; 12 environment-gated tests
  skipped.
- Desktop production-wiring test passed: 1/1.
- Full workspace typecheck passed.
- Production build passed.
- `pnpm exec vitest run --exclude '**/storage.test.ts'` was run twice and
  failed both times on the existing Windows
  `runchild-abort.test.ts` 1500ms timing assertion; 82 files and 696 tests
  passed, 19 were skipped. The failing file passed 4/4 when run alone. No
  Sandbox code was changed in this P0.

### GitHub Actions

- [PR checks run 30369184403](https://github.com/namelessawa/nl_codey/actions/runs/30369184403)
  passed on Windows for the reviewed code head `42fc5c3`: frozen install, full
  typecheck, Agent Core tests, Desktop production-wiring test, the test suite
  excluding `storage.test.ts`, and the production build all completed
  successfully. Later documentation-only heads must retain their own visible
  passing PR check; the Draft PR description records the current result.

### Storage ABI known gap

- The PR workflow explicitly excludes `storage.test.ts` under
  [hardening-backlog.md](hardening-backlog.md). That exclusion is not a pass:
  the real-DB suite remains unverified under Node because install prepares
  `better-sqlite3` for Electron's ABI.

See [baseline.md](baseline.md) for exact commands and
[feature-reality-matrix.md](feature-reality-matrix.md) for traceable evidence.

## Change isolation

The code changes are limited to:

- `packages/runtime/agent-core/src/service.ts`;
- `packages/runtime/agent-core/src/multi-agent.ts`;
- `packages/runtime/agent-core/src/dynamic-tools-security.test.ts`;
- `apps/desktop/src/main/services.ts`;
- `apps/desktop/src/main/services.test.ts`.

Documentation is limited to `README.md`, `AGENTS.md`, `CHANGELOG.md`, and this
audit directory. Pull-request verification adds only
`.github/workflows/pr-checks.yml`. The preserved mixed branch was not merged or
cherry-picked.

## Known unresolved security risk

This fix cannot isolate a complete Node plugin process. Once such a process is
started under the host user, direct Node filesystem/network/process APIs are
outside the bundle registration and dispatcher checks. OS-enforced plugin
isolation requires a separate restricted runner and is not implemented here.
