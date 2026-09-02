/** Embedding providers: OpenAI-compatible (real) and a deterministic mock. */

import { redactSensitiveText, type EmbeddingProvider } from "@nlc/shared";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MOCK_DIMENSIONS = 64;
const REQUEST_TIMEOUT_SECONDS = 30;
const MAX_DIMENSIONS = 4_096;
const MAX_MODEL_LENGTH = 256;

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
    this.apiKey = normalizeApiKey(config.apiKey);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.model = normalizeModel(config.model ?? DEFAULT_MODEL);
    this.dimensions = normalizeDimensions(
      config.dimensions ?? DEFAULT_DIMENSIONS,
    );
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
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          redactSensitiveText(
            `Embedding request failed (HTTP ${res.status}): ${detail}`,
            { secrets: [this.apiKey], maxLength: 4_000 },
          ),
        );
      }

      const json = (await res.json()) as EmbeddingResponse;
      return parseEmbeddingResponse(json, texts.length, this.dimensions);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Embedding request timed out after ${REQUEST_TIMEOUT_SECONDS}s`);
      }
      throw new Error(
        redactSensitiveText(err, {
          secrets: [this.apiKey],
          maxLength: 4_000,
          fallback: "Embedding request failed",
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
};

function parseEmbeddingResponse(
  json: EmbeddingResponse,
  expected: number,
  dimensions: number,
): number[][] {
  const data = json.data;
  if (!Array.isArray(data) || data.length !== expected) {
    throw new Error(
      `Embedding response shape invalid: expected ${expected} vectors, got ${data?.length ?? 0}`,
    );
  }
  const hasIndex = data.some((item) => item.index !== undefined);
  const ordered = hasIndex
    ? orderIndexedEmbeddings(data, expected)
    : data;
  return ordered.map((item) => {
    if (
      !Array.isArray(item.embedding) ||
      item.embedding.length !== dimensions
    ) {
      throw new Error(
        `Embedding vector dimension invalid: expected ${dimensions}, got ` +
          `${item.embedding?.length ?? 0}`,
      );
    }
    if (!item.embedding.every(Number.isFinite)) {
      throw new Error("Embedding response contains a non-finite vector value");
    }
    return item.embedding;
  });
}

function orderIndexedEmbeddings(
  data: NonNullable<EmbeddingResponse["data"]>,
  expected: number,
): NonNullable<EmbeddingResponse["data"]> {
  const ordered = new Array<(typeof data)[number] | undefined>(expected);
  for (const item of data) {
    if (
      !Number.isInteger(item.index) ||
      (item.index as number) < 0 ||
      (item.index as number) >= expected ||
      ordered[item.index as number] !== undefined
    ) {
      throw new Error("Embedding response contains invalid or duplicate indices");
    }
    ordered[item.index as number] = item;
  }
  if (ordered.some((item) => item === undefined)) {
    throw new Error("Embedding response indices are incomplete");
  }
  return ordered as NonNullable<EmbeddingResponse["data"]>;
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

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Embedding baseUrl must be a valid http(s) URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Embedding baseUrl must be an http(s) URL without credentials, query, or fragment",
    );
  }
  return stripTrailingSlashes(parsed.toString());
}

function normalizeApiKey(value: string | undefined): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("OpenAIEmbeddingProvider requires a valid apiKey");
  }
  return value;
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (
    !model ||
    model.length > MAX_MODEL_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(model)
  ) {
    throw new Error("Embedding model name is invalid");
  }
  return model;
}

function normalizeDimensions(value: number): number {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_DIMENSIONS
  ) {
    throw new Error(
      `Embedding dimensions must be an integer between 1 and ${MAX_DIMENSIONS}`,
    );
  }
  return value;
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
