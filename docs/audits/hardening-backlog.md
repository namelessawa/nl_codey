# Hardening backlog after dynamic-tool P0 — 2026-07-28

## Completed in this P0

- Make `DynamicToolBundle.mutatingNames` mandatory.
- Validate untrusted bundles before schema exposure or dispatch.
- Reject malformed classifications, duplicate schemas/classifications,
  host-reserved name collisions (including `write_file`), and undeclared calls.
- Enforce dynamic mutation classification in read-only and degraded modes.
- Enforce one schema-derived execution allowlist for each Multi-Agent role;
  dynamic tools are role-unassigned by default.
- Record bundle validation and factory failures as `[security]` Run Steps in
  single-agent and multi-agent paths, with bounded and credential/path-redacted
  factory error details.
- Remove Desktop's silent `buildPluginBundle` catch.
- Cover the trust boundary with 26 Agent Core tests and one Desktop
  production-wiring test.
- Add a pull-request GitHub Actions workflow for the verified non-Storage
  command set.

## Remaining risks (not implemented here)

### P1 — isolate plugin processes

The whitelist plugin path starts a full Node process with the host user's
filesystem and network authority. Environment scrubbing and manifest
permission checks do not prevent direct Node APIs from bypassing host helpers.
A future restricted process/container runner must provide OS-enforced
filesystem, network, process, and secret boundaries.

This P0 must not be described as solving that problem.

### P1 — make the Storage ABI test gate explicit

`pnpm install` prepares `better-sqlite3` for Electron while `pnpm test` uses
Node. The four Storage tests therefore fail at module load. Establish separate
Node-ABI and Electron-ABI integration commands/CI jobs instead of excluding or
weakening Storage assertions.

The PR workflow's exclusion is a temporary, explicit reference to this item;
it is not evidence that Storage has passed.

### P2 — capability-level dynamic bundle contract

`mutatingNames` answers the immediate safe/unsafe classification question. A
future dynamic source interface can carry a normalized capability set
(`network`, `git_write`, `secret_access`, and so on) and evaluate it at both
registration and dispatch. That work should preserve this P0's mandatory,
fail-closed classification.

### P2 — renderer evidence for security denials

AgentService persists and emits the `[security]` Step, and the Desktop
main-process wiring is tested. A renderer-level test should verify the Step is
rendered and remains associated with the correct run.

## Explicit non-goals

This branch does not implement a Docker plugin runner, Storage ABI
rearchitecture, new study workflows, new session behavior, or any other
feature expansion.
