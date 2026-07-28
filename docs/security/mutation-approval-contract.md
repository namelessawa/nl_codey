# Mutation and approval contract

`SEC-APPROVAL-001` is controlled by two committed artifacts:

- `packages/runtime/agent-core/src/mutation-policy.ts` is the executable,
  fail-closed authorization contract.
- `docs/security/mutation-inventory.json` is the generated, machine-readable
  inventory of mutation entrances, capabilities, gates, audit surfaces and
  denial/approval evidence.

Regenerate and verify the inventory with:

```powershell
pnpm docs:mutations
pnpm test:mutation-inventory
```

## Runtime rules

1. Model-initiated `apply_patch`, `write_memory`, confirmed `run_command`, and
   every dynamically classified mutator require a per-call authorization.
2. An authorization is bound to the tool-call id and name, is consumed once,
   and cannot authorize a later call. The executor refuses a mutator if the
   caller did not provide an authorization decision.
3. With command confirmation disabled, the user's shell setting is the
   capability grant for command execution. Docker/WSL file changes still stop
   at the separate staged-diff writeback approval.
4. Read-only, degraded-mode and multi-agent role denials happen before an
   approval is requested, so a forged/forbidden call cannot create a misleading
   approval prompt.
5. Non-patch approvals show tool name, capability and provenance only. Raw
   plugin or memory arguments are excluded from the approval preview.
6. Direct CLI, TUI and Desktop mutations are authorized by the validated,
   explicit user action or modal recorded in the inventory. Feature-triggered
   and startup mutations require their named feature/trusted-runtime proof.
7. Every allowed control also requires an audit proof. The inventory gate and
   unit test reject any entry that lacks its source or evidence file.

`write_file` is reserved but not advertised or dispatched. MCP mutation is
default-off because no MCP adapter exists. Full Node plugin process isolation is
not claimed here; it remains `SEC-PLUGIN-001` and is the next restricted-runner
batch.
