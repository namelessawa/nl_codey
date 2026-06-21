import { describe, it, expect } from "vitest";
import {
  matchesWhitelist,
  isBlockedHost,
  assertFetchAllowed,
} from "./domain-whitelist.js";

const WL = ["developer.mozilla.org", "*.github.io"] as const;

describe("matchesWhitelist", () => {
  it("matches a subdomain for a leading-wildcard entry", () => {
    expect(matchesWhitelist("foo.github.io", WL)).toBe(true);
  });

  it("matches the apex for a leading-wildcard entry", () => {
    expect(matchesWhitelist("github.io", WL)).toBe(true);
  });

  it("matches an exact host entry", () => {
    expect(matchesWhitelist("developer.mozilla.org", WL)).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(matchesWhitelist("evil.com", WL)).toBe(false);
  });

  it("does not let a wildcard match a lookalike suffix", () => {
    expect(matchesWhitelist("evilgithub.io", WL)).toBe(false);
  });
});

describe("isBlockedHost", () => {
  it("blocks IPv4 literals", () => {
    expect(isBlockedHost("8.8.8.8")).toBe(true);
    expect(isBlockedHost("192.168.0.1")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
  });

  it("blocks IPv6 literals", () => {
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("[fc00::1]")).toBe(true);
  });

  it("blocks localhost and *.local", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("printer.local")).toBe(true);
  });

  it("allows a normal hostname", () => {
    expect(isBlockedHost("developer.mozilla.org")).toBe(false);
  });
});

describe("assertFetchAllowed", () => {
  it("returns the parsed URL for an allowed https host", () => {
    const url = assertFetchAllowed("https://foo.github.io/page", WL);
    expect(url.hostname).toBe("foo.github.io");
  });

  it("throws for non-https", () => {
    expect(() => assertFetchAllowed("http://developer.mozilla.org", WL)).toThrow();
  });

  it("throws for a blocked host", () => {
    expect(() => assertFetchAllowed("https://127.0.0.1/x", WL)).toThrow();
  });

  it("throws for a host not in the whitelist", () => {
    expect(() => assertFetchAllowed("https://evil.com/x", WL)).toThrow();
  });
});
