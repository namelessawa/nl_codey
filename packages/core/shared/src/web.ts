/** Phase 3 web retrieval tool contracts. Network content is reference, never instruction. */

export type WebSearchProvider = "brave" | "tavily" | "duckduckgo";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchInput = {
  query: string;
  maxResults?: number;
};

export type WebSearchOutput = {
  query: string;
  results: WebSearchResult[];
};

export type WebFetchInput = {
  url: string;
};

export type WebFetchOutput = {
  url: string;
  /** Readability-extracted plain text, truncated to WEB_FETCH_MAX_CHARS. */
  text: string;
  truncated: boolean;
};

/** Default allowed domains for web_fetch (user may add/remove in settings). */
export const DEFAULT_WEB_WHITELIST: readonly string[] = [
  "developer.mozilla.org",
  "docs.python.org",
  "nodejs.org",
  "*.rs-lang.org",
  "doc.rust-lang.org",
  "pkg.go.dev",
  "*.github.io",
];

export const WEB_SEARCH_DEFAULT_MAX_RESULTS = 5;
export const WEB_FETCH_MAX_CHARS = 8000;
