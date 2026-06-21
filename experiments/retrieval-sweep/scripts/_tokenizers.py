"""Tokenization strategies for the BM25 retriever (E8 sweep dimension).

Four pre-registered strategies, each pure: str → list[str].

  - whitespace : `re.split(r"\\s+")`, lowercase. Naive baseline.
  - camel_split: whitespace + split camelCase / PascalCase. Closest to a
    "natural words" view of identifier-heavy code.
  - snake_split: whitespace + split `_`-separated identifiers. Python /
    Go friendly.
  - subtoken   : the union: whitespace + camel + snake + alphanumeric
    boundary. Most aggressive — minimizes OOV at the cost of length.
"""
from __future__ import annotations

import re
from typing import Callable


_WHITESPACE_PUNCT = re.compile(r"[\s\W]+", re.UNICODE)
_CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")
_ALPHA_RUN = re.compile(r"[A-Za-z0-9]+")


def _flatten_lower(words: list[str]) -> list[str]:
    return [w.lower() for w in words if w]


def tokenize_whitespace(text: str) -> list[str]:
    return _flatten_lower(_WHITESPACE_PUNCT.split(text))


def tokenize_camel_split(text: str) -> list[str]:
    out: list[str] = []
    for piece in _WHITESPACE_PUNCT.split(text):
        if not piece:
            continue
        sub = _CAMEL.findall(piece)
        if not sub:
            out.append(piece.lower())
        else:
            out.extend(s.lower() for s in sub)
    return out


def tokenize_snake_split(text: str) -> list[str]:
    out: list[str] = []
    for piece in _WHITESPACE_PUNCT.split(text):
        if not piece:
            continue
        for sub in piece.split("_"):
            if sub:
                out.append(sub.lower())
    return out


def tokenize_subtoken(text: str) -> list[str]:
    """Union of whitespace + camel + snake splits.

    Yields the same token both at its full form and at sub-piece granularity,
    so a query that searches for `parseFailure` matches a doc containing
    `parse_test_failure`, but also still matches a doc that uses the literal
    `parseFailure`.
    """
    out: list[str] = []
    for piece in _WHITESPACE_PUNCT.split(text):
        if not piece:
            continue
        plow = piece.lower()
        out.append(plow)
        # snake parts
        snake_parts = [p for p in piece.split("_") if p]
        # camel parts of each snake piece
        for sp in snake_parts:
            out.append(sp.lower())
            cam = _CAMEL.findall(sp)
            for c in cam:
                out.append(c.lower())
    # Dedup adjacent duplicates (keeps the token MULTISET — BM25 cares about
    # frequency — but trims trivial 3x repeats from a single identifier).
    out2: list[str] = []
    for tok in out:
        if len(tok) <= 1:
            continue
        out2.append(tok)
    return out2


TOKENIZERS: dict[str, Callable[[str], list[str]]] = {
    "whitespace":  tokenize_whitespace,
    "camel_split": tokenize_camel_split,
    "snake_split": tokenize_snake_split,
    "subtoken":    tokenize_subtoken,
}
