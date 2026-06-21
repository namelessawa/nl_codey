/** Truncate command output to a byte budget, appending a clear marker. */
export function truncateOutput(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  const slice = buf.subarray(0, maxBytes).toString("utf8");
  return {
    text: `${slice}\n\n[output truncated: exceeded ${maxBytes} bytes]`,
    truncated: true,
  };
}

/** Filter the environment passed to child processes to a minimal safe set. */
export function filteredEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "PATHEXT", "SystemRoot", "windir", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ComSpec", "LANG", "LC_ALL"];
  const out: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    const value = base[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
