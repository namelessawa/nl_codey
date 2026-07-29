# NL_Codey CLI

`nlc` opens the terminal UI or runs one NL_Codey agent task from a terminal.

After installing the package, verify the compiled entry point with:

```powershell
nlc --help
```

The published tarball contains the compiled `dist/index.js` entry and its
`bin/nlc.mjs` launcher. TypeScript source and private workspace packages are
development inputs, not runtime package dependencies.

## Host adapter protocol

Embedding hosts such as the VS Code extension launch:

```powershell
nlc run "<task>" --workspace "<absolute-path>" --json --host-protocol
```

Stdout remains newline-delimited `AgentEvent` JSON. When a `patch_ready` event
arrives, the host must show the preview and write exactly one decision line to
stdin:

```json
{"kind":"approval","runId":"<event runId>","decision":"approve"}
```

Use `"reject"` to deny the mutation. Invalid JSON, a mismatched Run ID,
oversized input, or closed stdin is treated as rejection. `--host-protocol`
requires `--json` and cannot be combined with `--yes`; hosts must spawn the
command with an argument array and shell execution disabled.
