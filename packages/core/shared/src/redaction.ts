const DEFAULT_MAX_LENGTH = 4_000;
const TRUNCATION_MARKER = "…(truncated)";
const REDACTED = "[REDACTED]";
const USER_HOME = "[USER_HOME]";

export type RedactionOptions = {
  /** Exact secret values known by the caller, such as the active provider key. */
  secrets?: readonly string[];
  /** Exact home-directory spellings when the caller has more precise context. */
  homePaths?: readonly string[];
  /** Final UTF-16 code-unit bound, including the truncation marker. */
  maxLength?: number;
  /** Used when conversion fails or the input contains no printable text. */
  fallback?: string;
};

/**
 * Turn an untrusted error/result into bounded, terminal-safe text.
 *
 * This function is browser-safe and deliberately independent of process.env.
 * It recognizes structural home paths and callers may add exact paths/secrets.
 * Apply it only at error/audit/display boundaries: user prose, source files,
 * patches and successful tool output are data and must not be rewritten.
 */
export function redactSensitiveText(
  value: unknown,
  options: RedactionOptions = {},
): string {
  const fallback = options.fallback ?? "Unknown error";
  let text = safeString(value, fallback);

  text = text
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g, " ")
    .trim();
  if (!text) text = fallback;

  for (const secret of options.secrets ?? []) {
    if (secret.length >= 3) text = text.split(secret).join(REDACTED);
  }
  for (const homePath of options.homePaths ?? []) {
    if (homePath.length >= 3) {
      text = replaceLiteralInsensitive(text, homePath, USER_HOME);
      text = replaceLiteralInsensitive(
        text,
        homePath.replaceAll("\\", "/"),
        USER_HOME,
      );
    }
  }

  text = text
    .replace(/\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s]+/gi, USER_HOME)
    .replace(/(?:^|[\s"'(])\/(?:home|Users)\/[^/\s"'()]+/g, (match) =>
      match.replace(/\/(?:home|Users)\/[^/\s"'()]+/, USER_HOME),
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s/]+@/gi,
      `$1${REDACTED}@`,
    )
    .replace(
      /([?&](?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|password|passwd|credential)=)[^&#\s]*/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /\b(?:Proxy-)?Authorization\s*[:=]\s*[^,;\r\n]+/gi,
      `Authorization: ${REDACTED}`,
    )
    .replace(
      /\b(?:X-API-Key|Api-Key)\s*[:=]\s*[^,;\s]+/gi,
      `X-API-Key: ${REDACTED}`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b(api[\s_-]?key|apikey|access[\s_-]?token|auth[\s_-]?token|token|secret|password|passwd|credential)\b\s*[:=]\s*[^\s,;]+/gi,
      `$1=${REDACTED}`,
    )
    .replace(
      /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|npm_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{12,})\b/g,
      REDACTED,
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      REDACTED,
    );

  return bound(text, options.maxLength ?? DEFAULT_MAX_LENGTH);
}

function safeString(value: unknown, fallback: string): string {
  try {
    const raw = value instanceof Error ? value.message : value;
    return typeof raw === "string" ? raw : String(raw ?? "");
  } catch {
    return fallback;
  }
}

function replaceLiteralInsensitive(
  input: string,
  literal: string,
  replacement: string,
): string {
  if (!literal) return input;
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return input.replace(new RegExp(escaped, "gi"), replacement);
}

function bound(text: string, maxLength: number): string {
  const limit = Number.isFinite(maxLength)
    ? Math.max(0, Math.floor(maxLength))
    : DEFAULT_MAX_LENGTH;
  if (text.length <= limit) return text;
  if (limit <= TRUNCATION_MARKER.length) return text.slice(0, limit);
  return `${text.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}
