import {
  type WebSearchInput,
  type WebSearchOutput,
  type WebSearchResult,
  WEB_SEARCH_DEFAULT_MAX_RESULTS,
} from "@coding-agent/shared";

/** A pluggable search backend. Returns raw results; clamping is done by webSearch. */
export type SearchBackend = (
  input: WebSearchInput,
) => Promise<WebSearchResult[]>;

/**
 * Run a web search through the given backend, clamping `maxResults` to
 * {@link WEB_SEARCH_DEFAULT_MAX_RESULTS} when unset or out of range.
 */
export async function webSearch(
  input: WebSearchInput,
  backend: SearchBackend,
): Promise<WebSearchOutput> {
  const requested = input.maxResults;
  const max =
    requested && requested > 0
      ? Math.min(requested, WEB_SEARCH_DEFAULT_MAX_RESULTS)
      : WEB_SEARCH_DEFAULT_MAX_RESULTS;

  const results = await backend({ ...input, maxResults: max });
  return { query: input.query, results: results.slice(0, max) };
}

/** Offline backend: always returns no results. */
export const mockBackend: SearchBackend = async () => [];

interface DuckDuckGoTopic {
  FirstURL?: string;
  Text?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  Heading?: string;
  AbstractURL?: string;
  AbstractText?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

function flattenTopics(topics: readonly DuckDuckGoTopic[]): WebSearchResult[] {
  const out: WebSearchResult[] = [];
  for (const topic of topics) {
    if (Array.isArray(topic.Topics)) {
      out.push(...flattenTopics(topic.Topics));
      continue;
    }
    if (topic.FirstURL && topic.Text) {
      out.push({
        title: topic.Text.split(" - ")[0] ?? topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      });
    }
  }
  return out;
}

/**
 * Best-effort backend over DuckDuckGo's public Instant Answer JSON API.
 * Keeps parsing minimal; returns [] on any network or shape error.
 */
export function createDuckDuckGoBackend(
  fetchImpl: typeof fetch = fetch,
): SearchBackend {
  return async (input: WebSearchInput): Promise<WebSearchResult[]> => {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", input.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("no_redirect", "1");

    let data: DuckDuckGoResponse;
    try {
      const response = await fetchImpl(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      data = (await response.json()) as DuckDuckGoResponse;
    } catch {
      return [];
    }

    const results: WebSearchResult[] = [];
    if (data.AbstractURL && data.AbstractText) {
      results.push({
        title: data.Heading ?? input.query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }
    if (Array.isArray(data.RelatedTopics)) {
      results.push(...flattenTopics(data.RelatedTopics));
    }
    return results;
  };
}
