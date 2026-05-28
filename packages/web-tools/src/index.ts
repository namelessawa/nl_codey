export {
  matchesWhitelist,
  isBlockedHost,
  assertFetchAllowed,
} from "./domain-whitelist.js";

export {
  extractReadableText,
  truncate,
  webFetch,
  type WebFetchOptions,
} from "./web-fetch.js";

export {
  webSearch,
  mockBackend,
  createDuckDuckGoBackend,
  type SearchBackend,
} from "./doc-search.js";
