/**
 * ID generators for sessions, messages, and state events.
 *
 * Session IDs embed a UTC timestamp so file listings sort chronologically
 * by name even without reading the JSON header — handy for `ls` and for
 * the tree builder's fast first pass.
 *
 * Message and event IDs are short random tokens; uniqueness is per-project
 * (we never join across project folders).
 */
import { randomBytes } from "node:crypto";

/** 12-hex random suffix — ~48 bits of entropy, plenty for per-project uniqueness. */
function randomSuffix(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Format a Date as `YYYYMMDDTHHMMSSZ` in UTC. Filesystem-safe and
 * lexicographically sortable.
 */
function formatUtc(d: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * `ses_<utc>_<6-hex>` — sortable by name within a project folder.
 *
 * @param now - injectable clock for tests; defaults to the wall clock.
 */
export function newSessionId(now: () => number = Date.now): string {
  return `ses_${formatUtc(new Date(now()))}_${randomSuffix(3)}`;
}

/** `msg_<8-hex>` — short token; unique within a project's session set. */
export function newMessageId(): string {
  return `msg_${randomSuffix(4)}`;
}

/** `evt_<6-hex>` — short token; unique within a session. */
export function newEventId(): string {
  return `evt_${randomSuffix(3)}`;
}
