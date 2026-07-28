# Dynamic-tool P0 reality matrix — 2026-07-28

This matrix covers only the security slice changed in this branch. It is not a
whole-repository feature inventory. Ratings are based on the clean
`origin/main` source plus this P0, production callers, and tests actually run.

Ratings:

- **Functional** — real runtime path exists and the tested behavior works, but
  broader end-to-end/recovery or process-isolation evidence is incomplete.
- **Partial** — an implementation exists, but a material security property is
  not enforced.

| Capability | Production entry | Runtime path | Test evidence | Visible/persisted failure | Rating |
| --- | --- | --- | --- | --- | --- |
| Mandatory mutation classification | `DynamicToolBundle` and `validateDynamicToolBundle` in `packages/runtime/agent-core/src/service.ts` | Every non-null factory result is validated before schema exposure or dispatcher retention | Missing field, non-array value, unknown name, duplicate name | Invalid bundle is disabled and recorded as `[security]` | Functional |
| Schema namespace integrity | `validateDynamicToolBundle` and `HOST_RESERVED_TOOL_NAMES` | Rejects duplicate schemas and collisions with Agent, extended, orchestrator, file-mutating, and degraded-dangerous host names | Duplicate schema, `run_command`, and `write_file` collision tests | Whole bundle is disabled; no partial registration | Functional |
| Declared-call dispatch boundary | Validated dispatcher wrapper | Only declared dynamic names reach the source dispatcher; built-ins fall through; other fabricated names return an error | Undeclared-call test proves source dispatcher is untouched | Structured tool error in the run trace | Functional |
| Single-agent integration | `AgentService.driveLoop` | Shared validated bundle feeds `agentToolSchemas` and `createToolExecutor` | Real `runTask` executes a declared read-only dynamic tool | Factory/validation denial is a persisted Run Step | Functional |
| Multi-agent role boundary | `runPlanner`, `runCoder`, and `runReviewer` | Each role derives visible schemas and `allowedToolNames` from one filtered schema set; dynamic tools belong to no role by default; denied calls stop before the shared executor | Real `runTask` paths forge Planner read/mutate, Coder read, and Reviewer mutate calls; every test proves the schema was absent, source dispatch was untouched, and `role_tool_denied` was returned | Structured tool result identifies role and tool; the attempted call remains in the run trace | Functional |
| Read-only enforcement | `filterDynamicBundleForReadOnly` | Classified mutating schemas are hidden; fabricated calls are rejected before source dispatch | Pure boundary test plus real `runTask` path | Structured read-only error; dispatcher not called | Functional |
| Degraded-mode enforcement | `wrapAssertForDynamicPlugins` plus executor gate | Mutating dynamic names inherit the installation gate through the built-in unsafe probe | Real `runTask` degraded-path test | Structured degraded-mode error; dispatcher not called | Functional |
| Desktop factory error propagation | `apps/desktop/src/main/services.ts` | `buildServices` lets `buildPluginBundle` throw into AgentService's audited resolver | `services.test.ts` calls real `buildServices` and real `AgentService.runTask` | Bounded, normalized, credential/user-home-redacted `[security]` Step; run continues on base tools | Functional |
| Full Node plugin process isolation | `apps/desktop/src/main/plugin-runtime.ts` | Plugin command runs as a Node process under the host user in the whitelist path | No OS-sandbox isolation test exists | Registration controls cannot contain direct Node filesystem/network syscalls | Partial |

## Evidence boundaries

- The Agent Core file contains 26 security tests, including true single-agent,
  role-specific multi-agent, read-only, factory-failure redaction, reserved
  namespace, and degraded-mode run paths.
- The Desktop test mocks native storage/settings/plugin construction at the
  boundary to avoid Electron-vs-Node ABI loading, but it uses the actual
  `buildServices` closure and actual `AgentService.runTask`; it does not invoke
  an AgentService private method.
- The P0-specific suites passed. The requested non-Storage full-suite command
  remained red on an existing Windows Sandbox abort-timing assertion under
  full-suite load; its isolated 4-test file passed. Storage remained excluded
  for the separately documented native ABI split.
- No conclusion here is derived from the preserved mixed branch.
