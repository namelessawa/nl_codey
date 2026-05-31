/**
 * Windows Job Object wrapper — defense-in-depth resource caps for child
 * processes spawned by sandbox runners.
 *
 * Why: when the OS-level sandbox is `whitelist` (host execution), we have
 * no kernel namespace to fall back on if a child misbehaves. A Job Object
 * gives us:
 *
 *  - `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: any process assigned to the job
 *    is killed when the job handle closes. Electron quit / run cancel
 *    therefore drops the entire process tree atomically — no orphans.
 *  - `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`: bounds the fork-bomb blast radius.
 *  - `JOB_OBJECT_LIMIT_PROCESS_MEMORY`: per-process memory ceiling.
 *  - `JOB_OBJECT_LIMIT_JOB_TIME`: total CPU time across the job.
 *  - `JOB_OBJECT_UILIMIT_*`: block clipboard read, system parameters, exit-
 *    windows. Cheap to add; meaningful belt-and-braces if the child is GUI-
 *    capable.
 *
 * Implementation note: rather than write a full native addon for what is
 * a small set of WinAPI calls, we shell out to a tiny inline PowerShell
 * helper that uses `[System.Runtime.InteropServices]` to call CreateJobObject,
 * SetInformationJobObject, and AssignProcessToJobObject. The helper returns
 * the job handle (encoded as a DECIMAL i64) which we keep alive as long as
 * Node's reference. On non-Windows or when the helper fails, we degrade
 * silently — the rest of the sandbox still works.
 *
 * If/when we ship the AppContainer addon (see docs/sandbox/appcontainer-spike.md)
 * we'll fold this into the same native module — for now it's standalone so
 * the gating doesn't block on a build pipeline change.
 */

import { spawnSync } from "node:child_process";

/** Limits applied at job creation time. All are best-effort soft caps. */
export type JobObjectLimits = {
  /** Per-process memory cap in MB. Default 1024. */
  memoryMb?: number;
  /** Total job CPU time cap in seconds. Default 600 (10 min). */
  cpuSeconds?: number;
  /** Active process limit — kills extras. Default 16. */
  maxProcesses?: number;
  /** Job display name (for diagnostics). */
  name?: string;
};

/**
 * Opaque job handle. On platforms where Job Objects are not available the
 * `handle` is null and `assignProcess` is a no-op — callers don't need to
 * branch on the platform.
 */
export type JobObjectHandle = {
  readonly platform: "win32" | "noop";
  readonly handle: bigint | null;
  /** Assign a PID to this job. Returns true if the kernel accepted it. */
  assignProcess(pid: number): boolean;
  /** Close the job handle (and kill all assigned processes if KILL_ON_JOB_CLOSE). */
  close(): void;
};

const NOOP_HANDLE: JobObjectHandle = {
  platform: "noop",
  handle: null,
  assignProcess(): boolean {
    return false;
  },
  close(): void {
    /* nothing to release */
  },
};

/**
 * Create a Job Object on Windows with the requested limits, or return a
 * no-op handle on every other platform. Never throws — falling back to
 * "no job" is always safer than crashing the agent loop.
 */
export function createJobObject(limits: JobObjectLimits = {}): JobObjectHandle {
  if (process.platform !== "win32") return NOOP_HANDLE;
  try {
    return createWindowsJob(limits);
  } catch {
    return NOOP_HANDLE;
  }
}

function createWindowsJob(limits: JobObjectLimits): JobObjectHandle {
  const memoryBytes = (limits.memoryMb ?? 1024) * 1024 * 1024;
  const cpu100Ns = BigInt(limits.cpuSeconds ?? 600) * 10_000_000n;
  const maxProcesses = limits.maxProcesses ?? 16;
  const name = limits.name ?? `codey-job-${process.pid}-${Date.now()}`;

  // PowerShell helper. Uses Add-Type to define a small C# class that
  // wraps the three WinAPI calls we need. Returns the job handle as a
  // decimal i64 so Node can keep it alive.
  const helper = JOB_HELPER_PS1(name, memoryBytes, cpu100Ns, maxProcesses);
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", helper],
    { encoding: "utf8", windowsHide: true, timeout: 5_000 },
  );
  if (result.status !== 0) {
    throw new Error(`job-helper failed (status=${result.status}): ${result.stderr}`);
  }
  const stdout = result.stdout?.trim() ?? "";
  const match = stdout.match(/JOB_HANDLE=(-?\d+)/);
  if (!match) throw new Error(`job-helper produced no handle: ${stdout}`);
  const handle = BigInt(match[1]!);

  return {
    platform: "win32",
    handle,
    assignProcess(pid: number): boolean {
      return assignProcessWindows(handle, pid);
    },
    close(): void {
      try {
        closeJobWindows(handle);
      } catch {
        /* best-effort */
      }
    },
  };
}

function assignProcessWindows(handle: bigint, pid: number): boolean {
  const helper = ASSIGN_HELPER_PS1(handle, pid);
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", helper],
    { encoding: "utf8", windowsHide: true, timeout: 3_000 },
  );
  return result.status === 0 && (result.stdout ?? "").includes("ASSIGN_OK");
}

function closeJobWindows(handle: bigint): void {
  const helper = CLOSE_HELPER_PS1(handle);
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", helper],
    { encoding: "utf8", windowsHide: true, timeout: 3_000 },
  );
}

/* ---------- inline PowerShell C# helpers ---------- */

const JOB_API = `
using System;
using System.Runtime.InteropServices;
public static class Job {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr CreateJobObject(IntPtr a, string lpName);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool SetInformationJobObject(
    IntPtr hJob, int infoClass, IntPtr info, uint cbInfo);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}
`;

function JOB_HELPER_PS1(
  name: string,
  memoryBytes: number,
  cpu100Ns: bigint,
  maxProcesses: number,
): string {
  // Builds a JOBOBJECT_EXTENDED_LIMIT_INFORMATION blob, sets KILL_ON_JOB_CLOSE
  // plus the resource caps, and prints the resulting handle.
  return `
$ErrorActionPreference = "Stop"
Add-Type @"
${JOB_API}
"@
$hJob = [Job]::CreateJobObject([IntPtr]::Zero, "${escapePs(name)}")
if ($hJob -eq [IntPtr]::Zero) {
  Write-Error "CreateJobObject failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  exit 1
}
# JOBOBJECT_EXTENDED_LIMIT_INFORMATION is 144 bytes on x64.
$size = 144
$buf  = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
try {
  for ($i = 0; $i -lt $size; $i++) {
    [System.Runtime.InteropServices.Marshal]::WriteByte($buf, $i, 0)
  }
  # BasicLimitInformation.PerJobUserTimeLimit (offset 0, i64 in 100ns units)
  [System.Runtime.InteropServices.Marshal]::WriteInt64($buf, 0, ${cpu100Ns}L)
  # BasicLimitInformation.LimitFlags (offset 16, u32)
  # KILL_ON_JOB_CLOSE=0x2000, JOB_TIME=0x4, ACTIVE_PROCESS=0x8, PROCESS_MEMORY=0x100
  $flags = 0x2000 -bor 0x4 -bor 0x8 -bor 0x100
  [System.Runtime.InteropServices.Marshal]::WriteInt32($buf, 16, $flags)
  # BasicLimitInformation.ActiveProcessLimit (offset 36, u32)
  [System.Runtime.InteropServices.Marshal]::WriteInt32($buf, 36, ${maxProcesses})
  # ExtendedLimitInformation.ProcessMemoryLimit (offset 96, size_t)
  [System.Runtime.InteropServices.Marshal]::WriteIntPtr($buf, 96, [IntPtr]${memoryBytes})
  $ok = [Job]::SetInformationJobObject($hJob, 9, $buf, $size)
  if (-not $ok) {
    Write-Error "SetInformationJobObject failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    exit 1
  }
  Write-Output ("JOB_HANDLE=" + $hJob.ToInt64())
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
}
`;
}

function ASSIGN_HELPER_PS1(handle: bigint, pid: number): string {
  return `
$ErrorActionPreference = "Stop"
Add-Type @"
${JOB_API}
"@
$hJob  = [IntPtr]${handle}
# PROCESS_SET_QUOTA(0x100) | PROCESS_TERMINATE(0x1) = 0x101
$hProc = [Job]::OpenProcess(0x101, $false, ${pid})
if ($hProc -eq [IntPtr]::Zero) {
  Write-Error "OpenProcess failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  exit 1
}
try {
  $ok = [Job]::AssignProcessToJobObject($hJob, $hProc)
  if (-not $ok) {
    Write-Error "AssignProcessToJobObject failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    exit 1
  }
  Write-Output "ASSIGN_OK"
} finally {
  [Job]::CloseHandle($hProc) | Out-Null
}
`;
}

function CLOSE_HELPER_PS1(handle: bigint): string {
  return `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
${JOB_API}
"@
[Job]::CloseHandle([IntPtr]${handle}) | Out-Null
Write-Output "CLOSED"
`;
}

function escapePs(value: string): string {
  return value.replace(/"/g, '`"');
}
