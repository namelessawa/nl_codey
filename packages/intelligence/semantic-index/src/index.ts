/** Public API for the @nlc/semantic-index package. */

export {
  OpenAIEmbeddingProvider,
  MockEmbeddingProvider,
  createEmbeddingProvider,
  type EmbedderConfig,
} from "./embedder.js";
export { chunkFile } from "./chunker.js";
export {
  cosineSimilarity,
  searchChunks,
  type ChunkStore,
} from "./vector-store.js";
export {
  SemanticIndexer,
  type IndexFile,
  type IndexProgress,
} from "./indexer.js";
export { semanticSearch, isIndexableFile } from "./search.js";
