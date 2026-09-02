import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  MockEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "@nlc/semantic-index";
import type { LLMConfig } from "@nlc/shared";
import {
  IntelligenceServices,
  embeddingConfigForLLM,
} from "./intelligence-services.js";
import type { Services } from "./services.js";

const BASE_CONFIG: LLMConfig = {
  provider: "openai",
  apiKey: "test-embedding-key",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  temperature: 0.2,
  maxTokens: 4096,
  timeoutSeconds: 60,
};

describe("Desktop embedding provider selection", () => {
  it("uses the OpenAI embedding protocol through the production factory", async () => {
    const requests: Array<{
      url: string;
      authorization: string | undefined;
      body: unknown;
    }> = [];
    const vector = new Array<number>(1536).fill(0);
    vector[0] = 1;
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ index: 0, embedding: vector }],
          }),
        );
      });
    });
    await listen(server);
    const port = (server.address() as AddressInfo).port;
    const config: LLMConfig = {
      ...BASE_CONFIG,
      baseUrl: `http://127.0.0.1:${port}/v1/`,
    };

    try {
      const embedder = intelligenceFor(config).embedder();
      expect(embedder).toBeInstanceOf(OpenAIEmbeddingProvider);
      await expect(embedder.embed(["repository context"])).resolves.toEqual([
        vector,
      ]);
      expect(requests).toEqual([
        {
          url: "/v1/embeddings",
          authorization: "Bearer test-embedding-key",
          body: {
            model: "text-embedding-3-small",
            input: ["repository context"],
            dimensions: 1536,
          },
        },
      ]);
    } finally {
      await close(server);
    }
  });

  it.each([
    "anthropic",
    "gemini",
    "deepseek",
    "openrouter",
    "custom",
  ] as const)(
    "keeps %s chat credentials off guessed embedding endpoints",
    async (provider) => {
      const config = {
        ...BASE_CONFIG,
        provider,
        baseUrl: `https://${provider}.example.invalid/v1`,
      };
      expect(embeddingConfigForLLM(config)).toEqual({});
      const embedder = intelligenceFor(config).embedder();
      expect(embedder).toBeInstanceOf(MockEmbeddingProvider);
      await expect(embedder.embed(["offline fallback"])).resolves.toHaveLength(
        1,
      );
    },
  );
});

function intelligenceFor(config: LLMConfig): IntelligenceServices {
  return new IntelligenceServices({
    settings: {
      getLLMConfig: () => config,
    },
  } as unknown as Services);
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
