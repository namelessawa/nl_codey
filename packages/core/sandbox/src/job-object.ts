/**
 * Compatibility surface for the planned native Windows Job Object host.
 *
 * A Win32 HANDLE is local to the process that owns it. The former
 * implementation created a handle in one short-lived PowerShell process and
 * attempted to assign/close it from later PowerShell processes. Those calls
 * could never operate on the original kernel handle, while adding seconds of
 * synchronous startup latency to every sandbox command.
 *
 * Until the AppContainer/native runner owns a live handle for the full child
 * lifetime, this API is deliberately an explicit no-op. `runChild` provides
 * verified process-tree termination separately; this shim must not imply that
 * resource limits are active.
 */

/** Limits reserved for the future native implementation. */
export type JobObjectLimits = {
  /** Per-process memory cap in MB. */
  memoryMb?: number;
  /** Total job CPU time cap in seconds. */
  cpuSeconds?: number;
  /** Active process limit. */
  maxProcesses?: number;
  /** Job display name (for diagnostics). */
  name?: string;
};

/** Opaque compatibility handle. It is currently always a no-op. */
export type JobObjectHandle = {
  readonly platform: "win32" | "noop";
  readonly handle: bigint | null;
  /** Assign a PID to this job. Returns true if the kernel accepted it. */
  assignProcess(pid: number): boolean;
  /** Close the job handle. */
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
 * Return the compatibility no-op handle.
 *
 * @deprecated A real implementation requires a native or resident host that
 * keeps the Win32 HANDLE alive. Do not treat this as a security boundary.
 */
export function createJobObject(limits: JobObjectLimits = {}): JobObjectHandle {
  void limits;
  return NOOP_HANDLE;
}
