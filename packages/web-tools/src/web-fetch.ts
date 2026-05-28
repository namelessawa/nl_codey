import {
  type WebFetchInput,
  type WebFetchOutput,
  DEFAULT_WEB_WHITELIST,
  WEB_FETCH_MAX_CHARS,
} from "@coding-agent/shared";
import { assertFetchAllowed } from "./domain-whitelist.js";

/** Tags whose entire content (incl. inner text) should be dropped. */
const STRIP_BLOCK_TAGS = ["script", "style", "nav", "footer", "header"] as const;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * PURE: strip script/style/nav/footer/header blocks, remove all remaining tags,
 * decode a few common HTML entities, and collapse whitespace. Best-effort
 * readability — not a full parser.
 */
export function extractReadableText(html: string): string {
  let out = html;

  for (const tag of STRIP_BLOCK_TAGS) {
    const blockRe = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi");
    out = out.replace(blockRe, " ");
  }

  // Drop HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, " ");

  // Remove all remaining tags.
  out = out.replace(/<[^>]+>/g, " ");

  // Decode common entities (named + the listed numeric ones).
  for (const [entity, value] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(value);
  }

  // Collapse runs of whitespace/newlines into single spaces, then trim.
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

/** PURE: clamp text to `max` chars, flagging whether truncation occurred. */
export function truncate(
  text: string,
  max: number = WEB_FETCH_MAX_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, max), truncated: true };
}

export interface WebFetchOptions {
  whitelist?: readonly string[];
  fetchImpl?: typeof fetch;
}

/**
 * Fetch a whitelisted https URL, extract readable text, and truncate it.
 * Throws if the URL is not allowed by {@link assertFetchAllowed}.
 */
export async function webFetch(
  input: WebFetchInput,
  opts: WebFetchOptions = {},
): Promise<WebFetchOutput> {
  const whitelist = opts.whitelist ?? DEFAULT_WEB_WHITELIST;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const parsed = assertFetchAllowed(input.url, whitelist);

  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      redirect: "follow",
      headers: { Accept: "text/html, text/plain;q=0.9, */*;q=0.1" },
    });
  } catch (error) {
    throw new Error(
      `web_fetch: request failed for ${parsed.toString()}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `web_fetch: ${parsed.toString()} returned HTTP ${response.status}`,
    );
  }

  const body = await response.text();
  const text = extractReadableText(body);
  const result = truncate(text);

  return {
    url: parsed.toString(),
    text: result.text,
    truncated: result.truncated,
  };
}
