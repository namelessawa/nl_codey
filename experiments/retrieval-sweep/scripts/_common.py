"""Shared helpers for the retrieval-sweep scripts.

No third-party deps — every script in this experiment runs on a fresh
Python ≥3.10 with only `pip install` of the explicit requirements files.
This module covers anything reusable across scripts (paths, JSONL I/O,
hashing, deterministic file-walks).
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator


# ---------------------------------------------------------------- paths

ROOT = Path(__file__).resolve().parents[1]          # experiments/retrieval-sweep
CORPORA_DIR = ROOT / "corpora"
QUERIES_DIR = ROOT / "queries"
RESULTS_DIR = ROOT / "results"
PLOTS_DIR = ROOT / "plots"
REPORTS_DIR = ROOT / "reports"
PAPER_DIR = ROOT / "paper"


# ---------------------------------------------------------------- JSONL

def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            fh.write("\n")
            n += 1
    return n


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if line:
                yield json.loads(line)


# ---------------------------------------------------------------- hashing

def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def short_id(*parts: str) -> str:
    """Deterministic 16-char identifier from arbitrary string parts.

    Used for stable corpus/file/query ids that survive re-derivation.
    """
    joined = "\x00".join(parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- file walks

LANGUAGE_EXT: dict[str, tuple[str, ...]] = {
    "typescript": (".ts", ".tsx"),
    "javascript": (".js", ".jsx", ".mjs"),
    "python":     (".py",),
    "go":         (".go",),
}

# Source dirs that are mostly noise for retrieval evaluation — every corpus
# benefits from excluding these regardless of language. Matched as path
# segments (case-insensitive).
EXCLUDE_SEGMENTS = frozenset({
    "node_modules", ".git", "dist", "build", "out", ".next", ".turbo",
    "target", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
    "coverage", ".cache", ".idea", ".vscode", "vendor", "third_party",
    ".bundle", ".sst",
})


def walk_source_files(root: Path, languages: Iterable[str]) -> list[Path]:
    """Deterministic source-file walk.

    Sorted lexicographically (POSIX path) so that any subset truncation is
    reproducible across machines/OSes. Excludes the common noise dirs above.
    """
    exts = tuple(e for lang in languages for e in LANGUAGE_EXT[lang])
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        # In-place prune so we don't descend into noise.
        dirnames[:] = [
            d for d in dirnames
            if d.lower() not in EXCLUDE_SEGMENTS and not d.startswith(".")
        ]
        for fn in filenames:
            if fn.endswith(exts):
                found.append(Path(dirpath) / fn)
    # POSIX-path sort for cross-platform stability.
    found.sort(key=lambda p: p.relative_to(root).as_posix())
    return found


# ---------------------------------------------------------------- corpus config

@dataclass(frozen=True)
class CorpusSpec:
    """A single corpus definition: how to find/clone it, what to keep."""
    name: str
    # If `local_path` is set, use that directly; else clone `git_url@git_rev`.
    local_path: Path | None
    git_url: str | None
    git_rev: str | None
    languages: tuple[str, ...]
    # Subset cap: stop after this many files OR this many bytes, whichever first.
    max_files: int = 15_000
    max_bytes: int = 30 * 1024 * 1024
    # Optional path-prefix filter (relative to root) so we keep e.g. cpython/Lib only.
    keep_prefix: tuple[str, ...] = ()


def keep_under_prefix(rel_posix: str, prefixes: tuple[str, ...]) -> bool:
    if not prefixes:
        return True
    return any(rel_posix == p or rel_posix.startswith(p + "/") for p in prefixes)


def language_of(path: Path) -> str:
    suffix = path.suffix.lower()
    for lang, exts in LANGUAGE_EXT.items():
        if suffix in exts:
            return lang
    return "other"


# ---------------------------------------------------------------- safe read

MAX_FILE_BYTES = 1 * 1024 * 1024  # 1MiB — we ignore anything bigger as noise


def read_text_or_none(path: Path) -> str | None:
    try:
        b = path.read_bytes()
    except OSError:
        return None
    if len(b) > MAX_FILE_BYTES:
        return None
    # Heuristic binary check.
    if b"\x00" in b[:8192]:
        return None
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return b.decode("utf-8", errors="replace")
        except Exception:
            return None


# ---------------------------------------------------------------- logging

def log(msg: str) -> None:
    print(f"[retrieval-sweep] {msg}", flush=True)


def progress(it: Iterable, total: int | None = None, every: int = 500, label: str = "") -> Iterator:
    """Light progress without tqdm dependency."""
    n = 0
    for item in it:
        n += 1
        if n % every == 0:
            if total:
                log(f"{label}: {n}/{total}")
            else:
                log(f"{label}: {n}")
        yield item
    log(f"{label}: done ({n} total)")
