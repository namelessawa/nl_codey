/** Embedding providers: OpenAI-compatible (real) and a deterministic mock. */

import type { EmbeddingProvider } from "@coding-agent/shared";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MOCK_DIMENSIONS = 64;
const REQUEST_TIMEOUT_SECONDS = 30;

export type EmbedderConfig = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
};

/**
 * OpenAI-compatible embedding provider. Uses global fetch (no SDK) and never
 * leaks the API key in thrown errors.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmbedderConfig) {
    if (!config.apiKey) {
      throw new Error("OpenAIEmbeddingProvider requires an apiKey");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = stripTrailingSlashes(config.baseUrl ?? DEFAULT_BASE_URL);
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_SECONDS * 1000);
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(redact(`Embedding request failed (HTTP ${res.status}): ${detail}`, this.apiKey));
      }

      const json = (await res.json()) as EmbeddingResponse;
      return parseEmbeddingResponse(json, texts.length);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Embedding request timed out after ${REQUEST_TIMEOUT_SECONDS}s`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(redact(message, this.apiKey));
    } finally {
      clearTimeout(timer);
    }
  }
}

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
};

function parseEmbeddingResponse(json: EmbeddingResponse, expected: number): number[][] {
  const data = json.data;
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(
      `Embedding response shape invalid: expected ${expected} vectors, got ${data?.length ?? 0}`,
    );
  }
  // Preserve request order via the index field when present.
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return ordered.map((item) => {
    if (!Array.isArray(item.embedding)) {
      throw new Error("Embedding response missing embedding vector");
    }
    return item.embedding;
  });
}

function redact(text: string, apiKey: string): string {
  if (apiKey && apiKey.length >= 4) {
    return text.split(apiKey).join("***");
  }
  return text;
}

/**
 * Strip trailing slashes from a URL without a regex. The naive `/\/+$/`
 * regex is polynomial in the trailing-slash count (CodeQL js/polynomial-redos).
 */
function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end -= 1;
  return end === url.length ? url : url.slice(0, end);
}

/**
 * Deterministic, network-free embedding provider for offline tests and dev.
 * Hashes token characters into a fixed-dimension bag-of-features vector, then
 * L2-normalizes so cosine similarity is meaningful.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = "mock-embedding";
  readonly dimensions: number;

  constructor(dimensions: number = MOCK_DIMENSIONS) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const token of tokens) {
      const bucket = hashString(token) % this.dimensions;
      vec[bucket] = (vec[bucket] ?? 0) + 1;
    }
    return l2Normalize(vec);
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Keep it a non-negative 32-bit integer.
  return hash >>> 0;
}

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Factory: returns a real provider when an apiKey is present, otherwise the
 * deterministic mock (so offline/dev flows work without a key).
 */
export function createEmbeddingProvider(config: EmbedderConfig = {}): EmbeddingProvider {
  if (config.apiKey) {
    return new OpenAIEmbeddingProvider(config);
  }
  return new MockEmbeddingProvider();
}
