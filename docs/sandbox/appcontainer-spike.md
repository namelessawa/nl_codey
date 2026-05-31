# AppContainer Native Sandbox — Feasibility Spike

> Status: SPIKE / Design only. No code shipped in this doc.
> Target: replace whitelist mode's "host execution + 13-command allowlist"
> with a real Windows OS-level sandbox equivalent to bwrap on Linux or
> sandbox-exec on macOS, with **zero user-installed dependencies**.
>
> Scope of this doc: technical route, dependencies, LOC estimate, code
> skeleton. Goal: enough detail for a future engineer to start coding
> without re-discovering everything.

---

## 1. Why AppContainer

Today the project has three sandbox modes (see `packages/sandbox/src`):

| Mode | OS sandbox? | Requires user install |
|------|-------------|-----------------------|
| `whitelist` | No (host execution) | None |
| `wsl` | Linux namespaces inside WSL2 | WSL2 + Ubuntu (~GBs) |
| `docker` | Linux container | Docker Desktop (~500MB + Hyper-V) |

For "open the installer, click run" we cannot ship WSL2 or Docker —
both are system components needing admin + reboot. AppContainer is the
only Windows-native option that:

- Is built into **Windows 8+** (works on Home, Pro, Enterprise — including 10/11)
- Needs **no admin install** — any unprivileged process can spawn one
- Provides a **real kernel-enforced sandbox** (the same one Edge tabs,
  Office Protected View, and Microsoft Store apps use)
- Confines **filesystem access via ACL** and **network via capabilities**
- Composes cleanly with **Job Objects** (resource caps, kill-on-job-close)

The cost: it's a Win32 API, so we need a small Node native addon
(or a prebuilt one via `node-gyp-build` / `prebuildify`).

## 2. How AppContainer works (essential model)

An AppContainer is a process started with a special **App Container SID**
plus a list of **capability SIDs**. The Windows kernel:

1. Strips the process token of every privilege not granted by a capability.
2. Rewrites file ACLs at access time — the process can only read/write
   resources whose ACL explicitly grants its AppContainer SID.
3. Network egress is gated by **capability SIDs**:
   `internetClient`, `internetClientServer`, `privateNetworkClientServer`.
   Without these, sockets fail with `WSAEACCES`.

Combined effect: a process inside an AppContainer with **no** capabilities
and ACLs granting it only the workspace directory cannot:

- Read `C:\Users\<me>\.ssh\id_rsa` (no ACL grant)
- Write anywhere outside the workspace (same)
- Open a TCP connection (no `internetClient` cap)
- Inject code into other processes (token stripped)
- Read clipboard (no `globalMediaControls` or UI access SIDs)
- Talk to the GUI session (different desktop SID)

This is **the same isolation model** Edge uses for sandboxed tabs.

## 3. End-to-end call sequence

```
                ┌─────────────────────────────────────────────────┐
                │  apps/desktop main process (Node, full trust)   │
                │                                                  │
                │  spawnInAppContainer(cmd, workspaceRoot)         │
                │            │                                     │
                │            ▼                                     │
                │  ┌──────────────────────────┐                    │
                │  │ appcontainer.node addon  │                    │
                │  │  (C++/Rust, ~600 LOC)    │                    │
                │  │                          │                    │
                │  │  1. DeriveAppContainerSidFromName             │
                │  │  2. Build SECURITY_CAPABILITIES               │
                │  │     - 0 caps when network disabled            │
                │  │     - {internetClient} when allowNetwork      │
                │  │  3. STARTUPINFOEX +                           │
                │  │     UpdateProcThreadAttribute(                │
                │  │       PROC_THREAD_ATTRIBUTE_                  │
                │  │         SECURITY_CAPABILITIES)                │
                │  │  4. AssignProcessToJobObject (kill-on-close)  │
                │  │  5. SetNamedSecurityInfo(workspaceRoot, …)    │
                │  │     grant (R/W) to AppContainer SID           │
                │  │  6. CreateProcessW                            │
                │  └──────────────────────────┘                    │
                │            │                                     │
                │            ▼                                     │
                │  child handle → wrap in Node ChildProcess         │
                │  stdout/stderr piped back, exit code captured    │
                └─────────────────────────────────────────────────┘
```

Failures at each step give us clear telemetry. ACL grant is reversible
(we restore on cleanup, so a crash leaves the workspace in a known state).

## 4. Dependencies

### Runtime (shipped with the app)
- `<appcontainer>.node` — the native addon, prebuilt for `win32-x64`
  and `win32-arm64`. ~150 KB per arch.
- No system DLLs beyond what `kernel32.dll` / `userenv.dll` /
  `advapi32.dll` already provide on every Windows install.

### Build-time (developers only)
- Visual Studio 2022 **Build Tools** with the Windows 11 SDK (≥10.0.22621.0)
- `node-gyp` 10+, Python 3.11 (for node-gyp), CMake (if we use CMake.js)
- Or: `prebuildify` + `node-gyp-build` so users get a binary and never
  need a compiler at install time

### Choice: C++ vs Rust
- **C++**: most natural fit — every example in MS Docs is C++. Fewer
  wrapper layers. ~600 LOC.
- **Rust**: cleaner error handling via `windows-rs` crate. ~750 LOC
  because of FFI boilerplate, but easier to maintain. Bigger binary
  (~250 KB stripped).

Recommendation: **Rust with `windows-rs` and `napi-rs`**. Two reasons:
matches the project's TypeScript-strict ethos better, and `napi-rs`
auto-generates the JS bindings + TypeScript .d.ts.

## 5. LOC estimate

| Component | Lang | LOC | Notes |
|-----------|------|----:|-------|
| `crates/appcontainer-rs/src/lib.rs` | Rust | ~500 | derive_sid, build_capabilities, spawn, assign_to_job |
| `crates/appcontainer-rs/src/acl.rs` | Rust | ~150 | grant_acl + restore_acl on workspace |
| `crates/appcontainer-rs/Cargo.toml` | TOML | ~30 | windows-rs, napi-rs deps |
| `packages/sandbox/src/appcontainer-runner.ts` | TS | ~180 | mirrors WslRunner/DockerRunner shape |
| `packages/sandbox/src/appcontainer-runner.test.ts` | TS | ~120 | smoke tests; spawn cmd.exe /c echo, assert exit 0 |
| `packages/sandbox/src/index.ts` | TS | ~5 | export AppContainerRunner |
| `packages/shared/src/sandbox.ts` | TS | ~5 | add "appcontainer" to SandboxMode |
| `apps/desktop/src/main/services.ts` | TS | ~10 | inject AppContainerRunner |
| `apps/desktop/src/renderer/src/components/settings/AgentSettings.tsx` | TSX | ~25 | 4th card "AppContainer (Windows native)" |
| Build CI | YAML | ~50 | matrix: win-x64 + win-arm64 prebuild |
| **Total** | | **~1075** | About a one-week milestone |

## 6. Code skeleton — Rust addon

```rust
// crates/appcontainer-rs/src/lib.rs
use napi_derive::napi;
use windows::Win32::Foundation::*;
use windows::Win32::Security::*;
use windows::Win32::Security::Isolation::*;
use windows::Win32::System::Threading::*;

#[napi(object)]
pub struct SpawnRequest {
  pub command_line: String,            // already shell-quoted by caller
  pub workspace_root: String,
  pub allow_network: bool,
  pub job_handle: Option<i64>,         // Job Object from job-object.ts
  pub container_name: String,          // stable, derived from app + workspace hash
}

#[napi(object)]
pub struct SpawnResult {
  pub pid: u32,
  pub stdout_fd: i64,                  // anonymous pipe read handle
  pub stderr_fd: i64,
  pub exit_event_handle: i64,          // signal when process exits
}

#[napi]
pub fn spawn_in_app_container(req: SpawnRequest) -> napi::Result<SpawnResult> {
  // 1. Derive/create AppContainer profile
  let sid = unsafe {
    let mut sid: PSID = PSID::default();
    DeriveAppContainerSidFromAppContainerName(
      &req.container_name.into(),
      &mut sid,
    )?;
    sid
  };

  // 2. Build SECURITY_CAPABILITIES
  let mut caps: Vec<SID_AND_ATTRIBUTES> = Vec::new();
  if req.allow_network {
    caps.push(well_known_capability("internetClient"));
  }
  // No other caps: no clipboard, no documents library, no removable storage.

  let security_caps = SECURITY_CAPABILITIES {
    AppContainerSid: sid,
    Capabilities: caps.as_mut_ptr(),
    CapabilityCount: caps.len() as u32,
    Reserved: 0,
  };

  // 3. STARTUPINFOEX with attribute list
  let mut size: usize = 0;
  unsafe { InitializeProcThreadAttributeList(None, 1, 0, &mut size); }
  let mut attr_list = vec![0u8; size];
  let attr_list_ptr = LPPROC_THREAD_ATTRIBUTE_LIST(attr_list.as_mut_ptr() as _);
  unsafe {
    InitializeProcThreadAttributeList(Some(attr_list_ptr), 1, 0, &mut size)?;
    UpdateProcThreadAttribute(
      attr_list_ptr,
      0,
      PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
      Some(&security_caps as *const _ as *const _),
      std::mem::size_of::<SECURITY_CAPABILITIES>(),
      None,
      None,
    )?;
  }

  let startup_info = STARTUPINFOEXW { /* ... pipes for stdout/stderr ... */ };

  // 4. Grant ACL on workspace before spawn (acl.rs)
  crate::acl::grant_appcontainer_access(&req.workspace_root, sid)?;

  // 5. CreateProcessW with EXTENDED_STARTUPINFO_PRESENT
  let mut process_info = PROCESS_INFORMATION::default();
  unsafe {
    CreateProcessW(
      None,
      Some(req.command_line.encode_utf16_null().as_mut_ptr()),
      None, None, true,
      EXTENDED_STARTUPINFO_PRESENT,
      None,
      Some(req.workspace_root.encode_utf16_null().as_ptr()),
      &startup_info.StartupInfo,
      &mut process_info,
    )?;
  }

  // 6. Optional: assign to job for kill-on-close + resource caps
  if let Some(job) = req.job_handle {
    unsafe { AssignProcessToJobObject(HANDLE(job as _), process_info.hProcess)?; }
  }

  Ok(SpawnResult {
    pid: process_info.dwProcessId,
    stdout_fd: stdout_read.0 as i64,
    stderr_fd: stderr_read.0 as i64,
    exit_event_handle: process_info.hProcess.0 as i64,
  })
}
```

## 7. Code skeleton — TS runner

```ts
// packages/sandbox/src/appcontainer-runner.ts
import { createReadStream } from 'node:fs';
import type {
  SandboxPolicy, SandboxRunRequest, SandboxRunResult,
} from '@coding-agent/shared';
import { assertNoSandboxEscape } from './sandbox-policy.js';
import { truncateOutput } from './output.js';

// `appcontainer-native` is the npm wrapper produced by napi-rs + prebuildify
import { spawnInAppContainer } from 'appcontainer-native';
import { createWorkspaceJob } from './job-object.js';

const MAX_OUTPUT_BYTES = 100_000;

export class AppContainerRunner {
  async run(req: SandboxRunRequest, policy: SandboxPolicy): Promise<SandboxRunResult> {
    assertNoSandboxEscape(req);

    const containerName = `coding-agent.${hashWorkspace(req.workspaceRoot)}`;
    const job = await createWorkspaceJob({
      memoryMb: policy.memoryCapMb ?? 1024,
      cpuPercent: policy.cpuCapPercent ?? 80,
      maxProcesses: 16,
    });

    const result = await spawnInAppContainer({
      commandLine: `cmd.exe /c ${req.command}`,
      workspaceRoot: req.workspaceRoot,
      allowNetwork: req.allowNetwork ?? policy.allowNetwork,
      jobHandle: job.handle,
      containerName,
    });

    // Read stdout/stderr from pipe FDs, wait for exit event, etc.
    const { exitCode, stdout, stderr, timedOut } = await collect(result, req.timeoutMs);

    return {
      command: req.command,
      mode: 'appcontainer',
      exitCode,
      stdout: truncateOutput(stdout, MAX_OUTPUT_BYTES).text,
      stderr: truncateOutput(stderr, MAX_OUTPUT_BYTES).text,
      timedOut,
      changedFiles: [], // TODO: diff workspace before/after
    };
  }
}
```

## 8. Open questions / things to verify in spike

1. **Pipe handling**: AppContainer processes can inherit handles only if
   we explicitly mark them inheritable AND add them to the attribute
   list's HANDLE_LIST. Need to confirm we can route stdout/stderr cleanly.
2. **Console host**: `cmd.exe` needs `conhost.exe`. ConHost has its own
   AppContainer flag — should "just work" but needs a smoke test.
3. **`changedFiles` tracking**: ideal world we'd use NTFS USN journal
   (read-only, fast, no monitoring overhead). Fallback: directory hash
   diff before/after. The current Docker/WSL runners just return `[]`
   anyway, so this is no regression.
4. **ACL grant lifecycle**: must restore the original ACL after the run.
   If the host process crashes mid-run, the workspace is left grantable
   to the AppContainer SID. Cleanup-on-startup task can scrub orphans by
   matching SIDs that start with our app's profile prefix.
5. **antivirus interaction**: heuristic AV may complain about a process
   running as AppContainer. We'll need to test on Defender + at least
   one third-party (Kaspersky, Bitdefender) before claiming "open-box".

## 9. Phased delivery plan

| Phase | Output | Effort |
|-------|--------|--------|
| Spike | This doc + Rust prototype that spawns `cmd /c echo hi` and returns the AppContainer SID | 2 days |
| MVP | AppContainerRunner integrated, behind a hidden flag in Settings, `whitelist`/`wsl`/`docker`/`appcontainer` choices | 4 days |
| Hardening | ACL restore on crash, USN-journal `changedFiles`, integration tests on Win10/11, AV smoke tests | 3 days |
| Default-on | Promote `appcontainer` to default on Windows, demote `whitelist` to fallback when addon load fails | 1 day |

Total: ~10 working days for a single-engineer spike-to-default rollout.

## 10. Decision pending

This doc is a route plan — **the team has not yet committed to building
it.** The decision to invest the ~10 days hinges on:

- Whether the Job Object + GUI approval combo in this same branch
  (the `instruction` branch) is "enough safety" to ship without it
- Whether telemetry from early users shows them actually opting into
  Docker mode (if yes, AppContainer is high-value; if everyone stays
  on whitelist, the install-gate UX may be enough)

When that decision is made, this doc becomes the implementation TOC.
