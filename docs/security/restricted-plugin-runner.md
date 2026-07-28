# Restricted plugin runner

`SEC-PLUGIN-001` is implemented by the Docker-only runner in
`packages/core/sandbox/src/restricted-plugin-runner.ts` and the Desktop adapter
in `apps/desktop/src/main/plugin-runtime.ts`.

Plugins remain disabled by default. Enabling the feature does not enable a
host-process fallback: a plugin manifest must select `sandbox: "docker"`, the
pinned image must already be available, and Docker Desktop must be running.
Whitelist and WSL plugin manifests fail closed at invocation time.

## Boundary

The host workspace is never mounted into the container. The runner creates a
bounded copy-on-write staging tree, removes common credential material before
mounting it, mounts the plugin installation read-only, and exposes only the
staging copy at `/workspace`.

Credential removal includes the repository-root `custom.txt`, `.env` variants
other than documented example files, npm/yarn/Python/netrc credential files,
Git credential files, SSH key names, and files under common SSH/cloud credential
directories. These files are moved to a sibling temporary directory that is not
mounted, then restored before the staging diff is calculated. The runner does
not read, log, serialize, or return their contents.

The container contract is:

- pinned `node:20-alpine` manifest digest with `--pull=never`;
- no network and private IPC namespaces;
- read-only root filesystem, all Linux capabilities dropped, no-new-privileges,
  and UID/GID `1000:1000`;
- 16 PIDs, 128 file descriptors, 16 MiB maximum file size, 256 MiB memory,
  0.5 CPU, and a 16 MiB no-exec temporary filesystem;
- at most 60 seconds and the existing 100 KiB Desktop result cap;
- no shell command construction.

The staging input additionally inherits `WorkspaceSandbox` limits: 8,000 files,
200 MiB total input, ignored dependency/build/VCS directories, and skipped
symlinks. Docker's own engine/VM and the pinned image are part of the trusted
computing base; this is not advertised as a general VM boundary.

## Mutation handoff

A successful plugin invocation returns text changes as `proposedPatch`,
binary-change paths as `binaryConflicts`, and `applied: false`. The runner always
cleans the staging directory and never writes the proposed change to the real
workspace. To proceed, the model must call the normal `apply_patch` tool, which
requires a separate single-use approval bound to that tool call.

Dynamic plugin invocation itself is also classified by the Batch 9 mutation
contract. A mutating plugin therefore has two deliberate controls: permission
to execute the dynamic mutator, followed by approval of the concrete host patch.

## Reproducible evidence

With Docker Desktop running:

```powershell
pnpm test:plugin:restricted
```

The script explicitly pulls the pinned digest before running the opt-in
integration test. The adversarial fixture proves that a plugin cannot observe a
host environment secret, an external host file, workspace `custom.txt`, the
external network, the host PID namespace, the read-only container root, or a
file beyond the configured size limit. It also proves that a staged text edit is
returned as a patch while both the host secret and real workspace remain
unchanged.

The default and general integration suites do not start Docker, pull an image,
or make a network call; the adversarial test is skipped unless the named script
sets its explicit environment gate.
