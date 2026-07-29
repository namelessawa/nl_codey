# NL Codey for VS Code

The extension runs the existing `nlc` CLI as a child process and communicates
through its fail-closed NDJSON host protocol. The AgentService, tool policy,
approval gate, sandbox, Storage, Sessions, snapshots, rollback, and recovery
behavior therefore stay in the proven CLI runtime instead of being duplicated
inside the VS Code extension host.

## Prerequisites

1. Install and configure the NL Codey CLI.
2. On Windows, set `nlCodey.cliPath` to the native `nlc.exe` launcher. If the
   installation only exposes an npm `.cmd` shim, point `nlCodey.cliPath` to
   the package's `bin/nlc.mjs` and set `nlCodey.nodePath` to `node.exe`.
   Command-shell `.cmd`/`.bat` shims are rejected rather than executed.
3. Open exactly one workspace folder.

Run **NL Codey: Run Task** from the Command Palette. Proposed mutations appear
in a modal preview and are not sent back to the CLI until **Apply** is chosen.
Closing the modal, choosing **Reject**, malformed protocol input, or a lost
process channel denies the mutation. **NL Codey: Stop Task** terminates the
active child process; startup reconciliation records an interrupted run on the
next CLI/Desktop launch.

The adapter always spawns with `shell: false` and passes the task and workspace
as separate arguments. Multi-root workspaces are currently rejected explicitly
rather than guessing which repository should receive a mutation.

## Build and package

From the repository root:

```powershell
pnpm package:vscode
pnpm smoke:vscode:artifact
```

The first command builds a versioned `release/nl-codey-vscode-<version>.vsix`
with the official VSCE packager. The second extracts the archive and requires
the manifest, bundled entry point and both public commands while rejecting
source, source maps, dependencies and local secret files.
