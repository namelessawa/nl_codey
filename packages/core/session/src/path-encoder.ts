/**
 * Encode an absolute working-directory path into a single, filesystem-safe
 * folder name used under `~/.nlc/agent.session/`.
 *
 * Rules (chosen so the encoded folder name remains human-readable and
 * round-trippable for casual inspection):
 *
 *  - Windows drive letters: `E:` → `E--` (colon becomes double dash);
 *    the slash that follows it on absolute paths (`E:\\foo`) is absorbed
 *    into that double-dash, so the result reads `E--foo` not `E---foo`.
 *  - Path separators (`/` and `\\`): collapsed to single dash.
 *  - Repeated separators stay collapsed (no `--` runs from path joins).
 *  - Leading slash on POSIX (`/home/foo`) → leading `-` is preserved as-is
 *    so `/home/foo` becomes `-home-foo`.
 *  - Characters that are illegal on either Windows or POSIX filesystems
 *    (`*`, `?`, `"`, `<`, `>`, `|`, ASCII control bytes) are replaced
 *    with `_`.
 *  - Whitespace stays as-is — folder names with spaces are fine on every
 *    supported platform; we only strip trailing whitespace from the
 *    entire encoded name.
 *
 * The encoder is intentionally *not* a 1:1 bijection: distinct project
 * paths that differ only in characters we collapse (e.g. `foo/bar` vs.
 * `foo\\bar`) will land in the same folder. That's acceptable because the
 * session file's `cwd` header records the original path losslessly, so
 * any caller that needs the real path reads it from the header rather
 * than reverse-decoding the folder name.
 */

const ILLEGAL_CHARS = /[\x00-\x1f"*<>?|]/g;

/** Encode an absolute cwd into a single folder name. Throws on empty input. */
export function encodeProjectFolder(cwd: string): string {
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new Error("encodeProjectFolder: cwd is required");
  }
  // 1) Collapse both kinds of separators into single dashes FIRST so
  //    `\\\\` and `//` don't leave artefacts. This must run before the
  //    drive-letter rule so the dash produced from the slash that
  //    follows `E:` can be folded into the drive prefix.
  let s = cwd.replace(/[\\/]+/g, "-");
  // 2) Drive letter `X:-...` → `X--...` — consume the dash the slash
  //    left behind so the result reads `E--proj` instead of `E---proj`.
  s = s.replace(/^([A-Za-z]):-/, "$1--");
  // 3) Drive letter with no trailing slash (relative drive paths like
  //    `E:foo`) still gets the recognisable `X--` prefix.
  s = s.replace(/^([A-Za-z]):/, "$1--");
  // 4) Any remaining colon (URI-style paths) becomes `_`.
  s = s.replace(/:/g, "_");
  // 5) Strip filesystem-illegal chars on Windows and POSIX.
  s = s.replace(ILLEGAL_CHARS, "_");
  // 6) Tidy trailing whitespace and stray trailing dashes — leading
  //    dashes are preserved (POSIX absolute path marker).
  s = s.replace(/\s+$/g, "").replace(/-+$/g, "");
  if (s.length === 0) {
    throw new Error("encodeProjectFolder: result is empty after encoding");
  }
  return s;
}
