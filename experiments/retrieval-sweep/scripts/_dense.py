"""Dense retriever — pluggable embedder with a deterministic mock fallback.

Two embedder backends:
  - `sentence_transformers.SentenceTransformer` — real, GPU/CPU.
  - HashedMockEmbedder — pure stdlib, deterministic; used for local
    pipeline validation when ST isn't installed (typical on a dev box
    without a CUDA stack). DO NOT trust mock numbers for the headline
    results — they exist only to confirm the retriever wiring.

Embeddings are L2-normalized after encoding so dot product = cosine.
Doc embeddings are cached as `.npy` (numpy) when numpy is available,
else as JSON. Cache key is (corpus, model_name, corpus_subset_n).

Two retrieval modes:
  - exhaustive   : `(D @ q.T)` over all docs. O(N·d).
  - approximate  : reserved for future faiss/hnswlib backend.

For our scale (≤2k docs ≤ 768 dim) exhaustive is fine on CPU.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Sequence

from _common import CORPORA_DIR, log


# ----------------------------------------------------------------------
# Backend interface
# ----------------------------------------------------------------------

class DenseEmbedder(ABC):
    name: str
    dim: int

    @abstractmethod
    def encode(self, texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
        ...

    def cache_dir(self) -> Path:
        d = CORPORA_DIR / "_embed_cache" / self.name
        d.mkdir(parents=True, exist_ok=True)
        return d


# ----------------------------------------------------------------------
# Mock embedder — deterministic hashed bag-of-words. No GPU, no deps.
# ----------------------------------------------------------------------

class HashedMockEmbedder(DenseEmbedder):
    """Deterministic mock for local pipeline validation.

    Tokenizes by alphanumeric runs (matches `_tokenizers.tokenize_whitespace`),
    hashes each token into one of `dim` buckets, and produces an L2-
    normalized vector. Two near-identical texts yield close vectors;
    completely different texts are near-orthogonal — enough for the
    retrieval harness to be exercised, not enough to draw conclusions
    from.
    """
    name = "mock-hashed-256"
    dim = 256

    _TOKEN = re.compile(r"[A-Za-z0-9]+")

    def encode(self, texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dim
            for tok in self._TOKEN.findall(text.lower()):
                h = int(hashlib.md5(tok.encode("utf-8")).hexdigest()[:8], 16)
                vec[h % self.dim] += 1.0
            n = math.sqrt(sum(v * v for v in vec))
            if n > 0.0:
                vec = [v / n for v in vec]
            out.append(vec)
        return out


# ----------------------------------------------------------------------
# Sentence-transformers backend — used on the GPU server.
# ----------------------------------------------------------------------

class STEmbedder(DenseEmbedder):
    def __init__(self, model_name: str, device: str | None = None) -> None:
        from sentence_transformers import SentenceTransformer
        import torch
        # Lazy device pick.
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        log(f"[dense] loading {model_name} on {device}")
        self.model = SentenceTransformer(model_name, device=device)
        self.name = model_name.replace("/", "__")
        self.dim = self.model.get_sentence_embedding_dimension() or 0

    def encode(self, texts: Sequence[str], batch_size: int = 32) -> list[list[float]]:
        import torch
        with torch.no_grad():
            embs = self.model.encode(
                list(texts),
                batch_size=batch_size,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
        return [row.tolist() for row in embs]


# ----------------------------------------------------------------------
# Cache + retrieval
# ----------------------------------------------------------------------

def _cache_path(embedder: DenseEmbedder, corpus: str, subset_n: int | None) -> Path:
    suffix = f"_n{subset_n}" if subset_n else ""
    return embedder.cache_dir() / f"{corpus}{suffix}.embeddings.json"


def encode_corpus(
    embedder: DenseEmbedder,
    corpus_name: str,
    docs: list[tuple[str, str]],
    subset_n: int | None = None,
    batch_size: int = 32,
) -> tuple[list[str], list[list[float]]]:
    cache = _cache_path(embedder, corpus_name, subset_n)
    if cache.exists():
        log(f"[dense] cache hit: {cache}")
        data = json.loads(cache.read_text(encoding="utf-8"))
        return data["doc_ids"], data["vectors"]
    log(f"[dense] encoding {corpus_name} ({len(docs)} docs) with {embedder.name}")
    t0 = time.perf_counter()
    doc_ids = [d[0] for d in docs]
    texts   = [d[1] for d in docs]
    vectors = embedder.encode(texts, batch_size=batch_size)
    log(f"[dense] encoded in {time.perf_counter() - t0:.1f}s")
    cache.write_text(
        json.dumps({"doc_ids": doc_ids, "vectors": vectors}, ensure_ascii=False),
        encoding="utf-8",
    )
    return doc_ids, vectors


def dense_score(
    query_text: str,
    embedder: DenseEmbedder,
    doc_ids: list[str],
    doc_vecs: list[list[float]],
    top_k: int = 20,
    floor_ratio: float = 0.0,
) -> list[tuple[str, float]]:
    """Cosine (= dot product for L2-normalized vectors) ranking."""
    q_vec = embedder.encode([query_text])[0]
    # L2-normalize the query (mock embedder may not normalize; ST does).
    norm = math.sqrt(sum(v * v for v in q_vec))
    if norm > 0.0:
        q_vec = [v / norm for v in q_vec]
    scores: list[tuple[str, float]] = []
    for did, dv in zip(doc_ids, doc_vecs):
        s = sum(a * b for a, b in zip(q_vec, dv))
        scores.append((did, s))
    scores.sort(key=lambda kv: kv[1], reverse=True)
    if floor_ratio > 0.0 and len(scores) > 1:
        top = scores[0][1]
        cutoff = top * floor_ratio
        scores = [scores[0]] + [s for s in scores[1:] if s[1] >= cutoff]
    return scores[:top_k]


# ----------------------------------------------------------------------
# Registry — pre-registered model list (DESIGN.md §5).
# ----------------------------------------------------------------------

REGISTERED_MODELS = (
    "sentence-transformers/all-MiniLM-L6-v2",
    "sentence-transformers/all-MiniLM-L12-v2",
    "sentence-transformers/all-mpnet-base-v2",
    "BAAI/bge-small-en-v1.5",
    "BAAI/bge-base-en-v1.5",
    "intfloat/e5-small-v2",
    "intfloat/e5-base-v2",
    "microsoft/unixcoder-base",
    "microsoft/codebert-base",
)


def get_embedder(model_name: str, mock: bool = False, device: str | None = None) -> DenseEmbedder:
    if mock or model_name == "mock":
        return HashedMockEmbedder()
    return STEmbedder(model_name, device=device)
