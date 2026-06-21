import { isIP } from "node:net";

/**
 * Domain whitelist + host-safety checks for web_fetch.
 * Network content is reference material, never instruction.
 */

/**
 * Match a hostname against a whitelist.
 * Supports leading-wildcard entries like `*.github.io` (matches any subdomain
 * AND the apex `github.io`) and exact host matches. Case-insensitive.
 */
export function matchesWhitelist(
  hostname: string,
  whitelist: readonly string[],
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  for (const raw of whitelist) {
    const entry = raw.toLowerCase().replace(/\.$/, "");
    if (!entry) continue;

    if (entry.startsWith("*.")) {
      const apex = entry.slice(2);
      // Matches apex itself and any subdomain of it.
      if (host === apex || host.endsWith(`.${apex}`)) return true;
      continue;
    }

    if (host === entry) return true;
  }

  return false;
}

/**
 * True for hosts that must never be fetched: any IP literal (v4/v6 — public or
 * private, since we only allow whitelisted hostnames), `localhost`, and
 * `*.local` / `*.localhost` mDNS names.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;

  if (host === "localhost" || host === "localhost.localdomain") return true;
  if (host.endsWith(".local") || host.endsWith(".localhost")) return true;

  // Strip IPv6 brackets if a bracketed literal slipped through.
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // Any raw IP literal (v4 or v6) is blocked regardless of range.
  if (isIP(bare) !== 0) return true;

  return false;
}

/**
 * Validate a URL for web_fetch: require https, reject blocked hosts, and require
 * the host to be in the whitelist. Returns the parsed URL or throws a clear Error.
 */
export function assertFetchAllowed(
  url: string,
  whitelist: readonly string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`web_fetch: invalid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `web_fetch: only https URLs are allowed (got ${parsed.protocol || "no"} protocol)`,
    );
  }

  const hostname = parsed.hostname;
  if (isBlockedHost(hostname)) {
    throw new Error(
      `web_fetch: host "${hostname}" is blocked (IP literal, localhost, or private range)`,
    );
  }

  if (!matchesWhitelist(hostname, whitelist)) {
    throw new Error(
      `web_fetch: host "${hostname}" is not in the allowed domain whitelist`,
    );
  }

  return parsed;
}
