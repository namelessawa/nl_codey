# Product feature surface matrix

Baseline: the stacked production-complete execution through Batch 51. A package
or UI label is not evidence that a product feature exists. “Alternative” means
the narrower supported behavior is named explicitly and the broader marketing
term must not be used.

| Requested feature | Shipped path and evidence | Host coverage | Security/recovery boundary | Disposition |
| --- | --- | --- | --- | --- |
| Intelligent Diff | Desktop/TUI/headless render the same approval-gated unified patch; semantic provenance and `analyze_impact` add bounded context | Desktop, TUI and headless share Agent Core; VS Code previews the same host-protocol patch | Patch application uses the unified single-use approval grant, snapshots and rollback | **Documented alternative:** deterministic diff + impact context. No separate AI diff-review product exists; do not market one |
| Multi-model Router | Provider presets, settings and TUI picker select one provider; `resolveLLM()` reads it for each new Run | Desktop and CLI/headless use their host-specific settings readers over the same provider factory | Keys stay in Electron safeStorage or process environment; no silent cross-provider credential reuse | **Documented alternative:** explicit per-Run provider selection. No automatic task router, fallback cascade or cost/quality policy exists |
| Git Workflow Agent | Shared local git tools plus Desktop status, PR-description and recorded-agent-branch discard helpers | Agent runtime can inspect local status/diff; richer workflow UI is Desktop-only | Mutations are inventoried/approval-gated; no remote credential or PR-creation flow is shipped | **Partial/local-only:** do not claim autonomous remote Git hosting |
| MCP | No adapter, server lifecycle or settings surface is shipped | None | The dynamic-tool trust boundary and mutation inventory reserve a future MCP source, but undeclared/mutating calls fail closed | **Unsupported/default-off:** documented alternative is the audited dynamic-tool port used by the Docker-only plugin runtime |
| Skills | Global/project Markdown skills are catalogued and loaded on demand through `invoke_skill`; TUI lists and can generate/install after an explicit target choice | Agent Core makes discovered skills available to Desktop, CLI/headless and VS Code Runs; authoring UI is TUI-only, with a native target-gated install journey | Project/global precedence is deterministic; install is a generated mutation-inventory row, native evidence proves no file exists before target confirmation, and the selected project write does not spill into the global root | **Functional with host alternative:** runtime support is shared; authoring/management is TUI-only |
| Diagnostics Export | `nlc diagnostics <run-id>` and Workbench Debug export the same versioned bounded Run bundle | CLI/headless writes `0600` create-new JSON or explicit stdout; Desktop uses a main-owned native save dialog | Renderer supplies only `runId`; task/diff/tool-result/snapshot/Git-payload content is omitted and retained strings are bounded/redacted | **Functional:** shared format with CLI/headless and Desktop entry points |

## Diagnostic bundle contract

- Includes Run state/timestamps/usage, record totals and dropped counts.
- Includes only error/command text summaries (1,000-character shared redaction
  cap). Other Step text is represented only by type/time/length.
- Snapshot source contents, user task text, task titles/descriptions/verifier
  commands and Git payloads are never serialized.
- The CLI refuses an existing destination instead of overwriting it. A parent
  directory must already exist.
- Desktop never accepts a renderer-supplied path. The user chooses the target
  in Electron's native save dialog, including its overwrite confirmation.

This matrix is the acceptance ledger for `FEATURE-001`; each broader name stays
unsupported or partial until its named host/security/recovery gaps receive
committed evidence.
