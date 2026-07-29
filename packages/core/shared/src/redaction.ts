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

  text = stripTerminalEscapeSequences(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
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

function stripTerminalEscapeSequences(input: string): string {
  const chunks: string[] = [];
  let plainStart = 0;
  let index = 0;

  while (index < input.length) {
    if (input.charCodeAt(index) !== 0x1b) {
      index += 1;
      continue;
    }
    if (index > plainStart) chunks.push(input.slice(plainStart, index));

    const introducer = input[index + 1];
    if (introducer === "[") {
      let cursor = index + 2;
      while (
        cursor < input.length &&
        input.charCodeAt(cursor) >= 0x30 &&
        input.charCodeAt(cursor) <= 0x3f
      ) {
        cursor += 1;
      }
      while (
        cursor < input.length &&
        input.charCodeAt(cursor) >= 0x20 &&
        input.charCodeAt(cursor) <= 0x2f
      ) {
        cursor += 1;
      }
      if (
        cursor < input.length &&
        input.charCodeAt(cursor) >= 0x40 &&
        input.charCodeAt(cursor) <= 0x7e
      ) {
        index = cursor + 1;
        plainStart = index;
        continue;
      }
    } else if (introducer === "]") {
      let cursor = index + 2;
      let sequenceEnd: number | null = null;
      while (cursor < input.length) {
        if (input.charCodeAt(cursor) === 0x07) {
          sequenceEnd = cursor + 1;
          break;
        }
        if (
          input.charCodeAt(cursor) === 0x1b &&
          input.charCodeAt(cursor + 1) === 0x5c
        ) {
          sequenceEnd = cursor + 2;
          break;
        }
        cursor += 1;
      }
      if (sequenceEnd !== null) {
        index = sequenceEnd;
        plainStart = index;
        continue;
      }
      chunks.push(input.slice(index));
      return chunks.join("");
    }

    chunks.push(input[index] ?? "");
    index += 1;
    plainStart = index;
  }

  if (plainStart < input.length) chunks.push(input.slice(plainStart));
  return chunks.join("");
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
