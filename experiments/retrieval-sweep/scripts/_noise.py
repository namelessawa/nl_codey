"""Deterministic per-query noise injection for E6.

Six kinds of mutation, all controlled by a per-query seed so the SAME
(query, kind, rate) always produces the SAME corrupted query.

  - none     : passthrough.
  - char_del : delete `rate * len(q)` characters uniformly.
  - char_ins : insert that many random alpha chars.
  - char_sub : substitute that many characters with another alpha.
  - word_del : drop that fraction of whitespace-tokens.
  - case_flip: flip the case of that fraction of letters.

The seed is `query_id` hashed → ensures the same query corrupts the same
way across reruns and across the abs/rel/dense comparisons within one
sweep, so cross-method deltas at a given noise level aren't confounded
by different mutation samples.
"""
from __future__ import annotations

import hashlib
import random
import string
from typing import Callable

_ALPHA = string.ascii_lowercase


def _rng(seed_text: str, salt: str) -> random.Random:
    h = hashlib.sha1(f"{seed_text}\x00{salt}".encode("utf-8")).digest()
    seed = int.from_bytes(h[:8], "big", signed=False)
    return random.Random(seed)


def noise_none(q: str, rate: float, seed: str) -> str:
    return q


def noise_char_del(q: str, rate: float, seed: str) -> str:
    if rate <= 0 or len(q) < 2:
        return q
    rng = _rng(seed, "char_del")
    chars = list(q)
    drop = max(1, int(round(rate * len(chars))))
    for _ in range(drop):
        if len(chars) < 2:
            break
        i = rng.randrange(0, len(chars))
        chars.pop(i)
    return "".join(chars)


def noise_char_ins(q: str, rate: float, seed: str) -> str:
    if rate <= 0:
        return q
    rng = _rng(seed, "char_ins")
    chars = list(q)
    n = max(1, int(round(rate * len(chars))))
    for _ in range(n):
        i = rng.randrange(0, len(chars) + 1)
        chars.insert(i, rng.choice(_ALPHA))
    return "".join(chars)


def noise_char_sub(q: str, rate: float, seed: str) -> str:
    if rate <= 0 or len(q) == 0:
        return q
    rng = _rng(seed, "char_sub")
    chars = list(q)
    n = max(1, int(round(rate * len(chars))))
    for _ in range(n):
        i = rng.randrange(0, len(chars))
        chars[i] = rng.choice(_ALPHA)
    return "".join(chars)


def noise_word_del(q: str, rate: float, seed: str) -> str:
    if rate <= 0:
        return q
    rng = _rng(seed, "word_del")
    words = q.split()
    if len(words) <= 1:
        return q
    keep_n = max(1, len(words) - int(round(rate * len(words))))
    rng.shuffle(words)
    return " ".join(words[:keep_n])


def noise_case_flip(q: str, rate: float, seed: str) -> str:
    if rate <= 0:
        return q
    rng = _rng(seed, "case_flip")
    chars = list(q)
    indices = [i for i, c in enumerate(chars) if c.isalpha()]
    if not indices:
        return q
    n = max(1, int(round(rate * len(indices))))
    rng.shuffle(indices)
    for i in indices[:n]:
        c = chars[i]
        chars[i] = c.lower() if c.isupper() else c.upper()
    return "".join(chars)


NOISES: dict[str, Callable[[str, float, str], str]] = {
    "none":       noise_none,
    "char_del":   noise_char_del,
    "char_ins":   noise_char_ins,
    "char_sub":   noise_char_sub,
    "word_del":   noise_word_del,
    "case_flip":  noise_case_flip,
}
