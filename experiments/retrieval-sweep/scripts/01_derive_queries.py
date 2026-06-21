"""Derive (query, gold target) pairs from corpus structure — zero labels.

For each corpus:
  - Read corpus.jsonl
  - Per language extractor, pull defns/imports/tests/calls
  - Build 7 query families, dedup, enforce uniqueness, persist to JSONL.

Each output row has:

    {
      "query_id":   "<16hex>",
      "family":     "func_name" | ... ,
      "query":      "the actual query string",
      "target_id":  "<file_id>",
      "target_path": "rel/path.ts",
      "provenance": {...},
      "corpus":     "..."
    }

Run:
    python scripts/01_derive_queries.py             # all collected corpora
    python scripts/01_derive_queries.py coding-agent
"""
from __future__ import annotations

import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

from _common import (
    CORPORA_DIR,
    QUERIES_DIR,
    log,
    read_jsonl,
    short_id,
    write_jsonl,
)
from _extractors import CallSite, Defn, Import, TestCase, extract


# Per-family hard cap so a single huge corpus doesn't dominate the
# eval. Generous (we want lots of data) but bounded for memory.
MAX_PER_FAMILY = 8_000


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _norm_modules(module: str, all_paths: dict[str, str]) -> str | None:
    """Resolve an import module string to a corpus rel_path, or None.

    Heuristics:
      - Python `pkg.subpkg.mod` → look for `pkg/subpkg/mod.py` and __init__.py.
      - TS `./relative` / `../relative` → handled at the call site (needs
        the importing file's dir); skipped here unless it's a clean rel match.
      - Go `pkg/foo` → look for `pkg/foo/*.go` and pick the lexicographically
        first as a stable representative.
      - Workspace alias like `@pkg/foo` → look for files under `packages/foo/`.
    """
    if not module:
        return None
    # Python dotted form.
    if re.fullmatch(r"[A-Za-z_][\w.]*", module):
        parts = module.split(".")
        cand = "/".join(parts)
        for suffix in (".py", "/__init__.py"):
            for prefix in ("", "Lib/", "packages/"):
                target = f"{prefix}{cand}{suffix}"
                if target in all_paths:
                    return target
        # Go-style "pkg/foo/bar"
        first_go = next(
            (p for p in all_paths if p.startswith(cand + "/") and p.endswith(".go")),
            None,
        )
        if first_go:
            return first_go
    # Workspace alias '@scope/pkg' or path-like 'pkg/sub' (no leading dot)
    if "/" in module and not module.startswith("."):
        # Try direct file match.
        for suffix in ("", ".ts", ".tsx", ".js", ".mjs", ".py", ".go", "/index.ts", "/index.js"):
            target = module + suffix
            if target in all_paths:
                return target
        # `@coding-agent/shared` style → look under packages/.
        if module.startswith("@"):
            tail = module.split("/", 1)[-1]
            for cand in (f"packages/{tail}/src/index.ts",
                         f"packages/{tail}/src/index.js"):
                if cand in all_paths:
                    return cand
        # Go-style: pick a file in the package dir.
        first = next((p for p in all_paths if p.startswith(module + "/")
                      and (p.endswith(".go") or p.endswith(".ts") or p.endswith(".py"))),
                     None)
        if first:
            return first
    return None


def _resolve_relative_import(module: str, importer_path: str,
                             all_paths: dict[str, str]) -> str | None:
    """Resolve a relative TS import like `./foo` or `../foo.js`."""
    if not module.startswith("."):
        return None
    base = Path(importer_path).parent.as_posix()
    raw = (Path(base) / module).as_posix()
    raw = re.sub(r"/\./", "/", raw)
    # Strip trailing ".js" pretender — the actual file may be .ts.
    candidates = [raw]
    if raw.endswith(".js"):
        candidates.append(raw[:-3] + ".ts")
    candidates.extend([raw + ".ts", raw + ".tsx", raw + ".js",
                       raw + ".py", raw + ".go",
                       raw + "/index.ts", raw + "/index.js"])
    # Collapse `..` segments deterministically.
    norm: list[str] = []
    for cand in candidates:
        parts: list[str] = []
        for seg in cand.split("/"):
            if seg == "..":
                if parts:
                    parts.pop()
            elif seg in ("", "."):
                continue
            else:
                parts.append(seg)
        norm.append("/".join(parts))
    for p in norm:
        if p in all_paths:
            return p
    return None


def _camel_words(name: str) -> list[str]:
    return re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+", name)


def _identifier_human(name: str) -> str:
    """Turn `parseTestFailure` → `parse test failure`. Helpful for docstrings
    that are paired with code-style identifiers."""
    return " ".join(w.lower() for w in _camel_words(name))


def _is_test_file(rel_path: str) -> bool:
    p = rel_path.lower()
    return (
        ".test." in p or p.endswith(".test.ts") or p.endswith(".test.tsx")
        or p.endswith(".test.js") or p.endswith("_test.go")
        or "/tests/" in p or p.startswith("tests/") or p.startswith("test/")
        or "/test_" in p or p.split("/")[-1].startswith("test_")
    )


def _test_target_for(rel_path: str, all_paths: dict[str, str]) -> str | None:
    """Map a test file path to its 'file under test' if convention is clear."""
    p = rel_path
    cand: list[str] = []
    if p.endswith(".test.ts"):
        cand.append(p.replace(".test.ts", ".ts"))
    if p.endswith(".test.tsx"):
        cand.append(p.replace(".test.tsx", ".tsx"))
    if p.endswith(".test.js"):
        cand.append(p.replace(".test.js", ".js"))
    if p.endswith("_test.go"):
        cand.append(p.replace("_test.go", ".go"))
    # python: tests/test_X.py → src equivalent (search by file name).
    name = p.split("/")[-1]
    if name.startswith("test_") and name.endswith(".py"):
        target_name = name[len("test_"):]
        # Look for that file anywhere in the corpus.
        for c in all_paths:
            if c.endswith("/" + target_name):
                cand.append(c)
                break
    for c in cand:
        if c in all_paths:
            return c
    return None


# ----------------------------------------------------------------------
# Family builders
# ----------------------------------------------------------------------

def build_func_name(
    file_records: list[dict],
    extracted: dict[str, dict],
) -> list[dict]:
    """A query for each *unambiguous* top-level identifier in the corpus.

    Uniqueness check: if the SAME identifier is defined as a top-level
    function/class in more than one file in this corpus, the pair is
    dropped (the gold answer would be ambiguous).
    """
    by_name: dict[str, list[tuple[str, Defn]]] = defaultdict(list)
    for rec in file_records:
        defns = extracted[rec["rel_path"]]["defns"]
        for d in defns:
            # Only exported / public top-level defs — internal helpers are
            # too often duplicated across modules to label unambiguously.
            if not d.exported:
                continue
            if d.kind not in ("function", "class"):
                continue
            if len(d.name) < 3:
                continue
            by_name[d.name].append((rec["rel_path"], d))

    out: list[dict] = []
    for name, hits in by_name.items():
        if len(hits) != 1:
            continue
        rel_path, d = hits[0]
        target_id = next(r["file_id"] for r in file_records if r["rel_path"] == rel_path)
        out.append({
            "family":     "func_name",
            "query":      name,
            "target_id":  target_id,
            "target_path": rel_path,
            "provenance": {"defn_kind": d.kind, "line": d.line},
        })
    return out


def build_docstring(
    file_records: list[dict],
    extracted: dict[str, dict],
) -> list[dict]:
    out: list[dict] = []
    for rec in file_records:
        rel = rec["rel_path"]
        for d in extracted[rel]["defns"]:
            if not d.docstring or len(d.docstring) < 20:
                continue
            # Truncate to a sentence-ish chunk to keep queries short.
            doc = re.split(r"(?<=[.。!?])\s+", d.docstring.strip())[0]
            doc = doc.strip()
            if len(doc) < 20 or len(doc) > 280:
                continue
            out.append({
                "family":     "docstring",
                "query":      doc,
                "target_id":  rec["file_id"],
                "target_path": rel,
                "provenance": {"defn_name": d.name, "line": d.line},
            })
    return out


def build_test_name(
    file_records: list[dict],
    extracted: dict[str, dict],
    all_paths: dict[str, str],
) -> list[dict]:
    out: list[dict] = []
    for rec in file_records:
        rel = rec["rel_path"]
        if not _is_test_file(rel):
            continue
        target = _test_target_for(rel, all_paths)
        if target is None:
            continue
        target_id = next(
            (r["file_id"] for r in file_records if r["rel_path"] == target),
            None,
        )
        if target_id is None:
            continue
        for t in extracted[rel]["tests"]:
            label = t.description.strip()
            if len(label) < 5 or len(label) > 200:
                continue
            out.append({
                "family":     "test_name",
                "query":      label,
                "target_id":  target_id,
                "target_path": target,
                "provenance": {"test_file": rel, "line": t.line},
            })
    return out


def build_call_site(
    file_records: list[dict],
    extracted: dict[str, dict],
) -> list[dict]:
    # Map each unambiguous top-level identifier → defining file.
    by_name: dict[str, tuple[str, str]] = {}
    name_count: Counter[str] = Counter()
    for rec in file_records:
        for d in extracted[rec["rel_path"]]["defns"]:
            if d.kind in ("function", "class") and d.exported and len(d.name) >= 3:
                if name_count[d.name] == 0:
                    by_name[d.name] = (rec["rel_path"], rec["file_id"])
                else:
                    by_name.pop(d.name, None)
                name_count[d.name] += 1

    out: list[dict] = []
    for rec in file_records:
        rel = rec["rel_path"]
        # Skip if this IS the defining file — no cross-file signal.
        for c in extracted[rel]["calls"]:
            if c.callee not in by_name:
                continue
            target_path, target_id = by_name[c.callee]
            if target_path == rel:
                continue
            snippet = c.full_text.strip()
            if len(snippet) < 5 or len(snippet) > 200:
                continue
            out.append({
                "family":     "call_site",
                "query":      snippet,
                "target_id":  target_id,
                "target_path": target_path,
                "provenance": {"callee": c.callee, "caller_file": rel,
                               "line": c.line},
            })
    return out


def build_import_target(
    file_records: list[dict],
    extracted: dict[str, dict],
    all_paths: dict[str, str],
) -> list[dict]:
    out: list[dict] = []
    for rec in file_records:
        rel = rec["rel_path"]
        for imp in extracted[rel]["imports"]:
            resolved = (
                _resolve_relative_import(imp.module, rel, all_paths)
                or _norm_modules(imp.module, all_paths)
            )
            if not resolved or resolved == rel:
                continue
            target_id = next(
                (r["file_id"] for r in file_records if r["rel_path"] == resolved),
                None,
            )
            if target_id is None:
                continue
            out.append({
                "family":     "import_target",
                "query":      imp.module,
                "target_id":  target_id,
                "target_path": resolved,
                "provenance": {"specifier": imp.specifier,
                               "importer_file": rel, "line": imp.line},
            })
    return out


def build_commit_msg(
    file_records: list[dict],
    corpus_root: Path,
    max_commits: int = 4000,
) -> list[dict]:
    """One query per (commit, file) for commits whose subject is long enough
    and that changed exactly one tracked source file (avoids ambiguity)."""
    try:
        cmd = ["git", "log", f"-n{max_commits}", "--name-only",
               "--pretty=format:%H%n%s%n--end--"]
        # text=True on Windows defaults to GBK/cp936 and crashes on any
        # non-ASCII in commit messages — force utf-8 with replace so the
        # command can never raise.
        p = subprocess.run(cmd, cwd=corpus_root, check=False,
                           capture_output=True,
                           encoding="utf-8", errors="replace")
        raw = p.stdout or ""
    except Exception:
        return []
    if not raw:
        return []
    by_path = {r["rel_path"]: r["file_id"] for r in file_records}
    out: list[dict] = []
    cur_sha = None
    cur_subj = ""
    cur_files: list[str] = []
    for line in raw.splitlines() + ["--end--"]:
        if line == "--end--":
            if cur_subj and cur_files:
                # Keep only files in our subset, and only if exactly one survives.
                in_corpus = [f for f in cur_files if f in by_path]
                if len(in_corpus) == 1 and 12 <= len(cur_subj) <= 200:
                    rel = in_corpus[0]
                    out.append({
                        "family":     "commit_msg",
                        "query":      cur_subj.strip(),
                        "target_id":  by_path[rel],
                        "target_path": rel,
                        "provenance": {"sha": cur_sha},
                    })
            cur_sha, cur_subj, cur_files = None, "", []
            continue
        if cur_sha is None and re.fullmatch(r"[0-9a-f]{7,40}", line):
            cur_sha = line
        elif cur_sha and not cur_subj:
            cur_subj = line
        elif line:
            cur_files.append(line)
    return out


def build_mutated_id(
    func_name_pairs: list[dict],
    seed: int = 17,
) -> list[dict]:
    """Apply a controlled character mutation to each unique func_name query.

    Each output query is the mutated identifier; target stays the original
    defining file. Three mutation strategies, picked round-robin so the
    family has predictable composition.
    """
    rng = random.Random(seed)
    out: list[dict] = []
    strats = ["typo", "case", "transpose"]
    for i, base in enumerate(func_name_pairs):
        ident: str = base["query"]
        if len(ident) < 5:
            continue
        strat = strats[i % len(strats)]
        mutated = _mutate(ident, strat, rng)
        if mutated == ident:
            continue
        out.append({
            "family":     "mutated_id",
            "query":      mutated,
            "target_id":  base["target_id"],
            "target_path": base["target_path"],
            "provenance": {"original": ident, "strategy": strat},
        })
    return out


def _mutate(ident: str, strategy: str, rng: random.Random) -> str:
    if strategy == "typo":
        i = rng.randrange(1, len(ident) - 1)
        return ident[:i] + ident[i + 1:]                # single-char deletion
    if strategy == "case":
        i = rng.randrange(0, len(ident))
        ch = ident[i]
        flipped = ch.lower() if ch.isupper() else ch.upper()
        return ident[:i] + flipped + ident[i + 1:]
    if strategy == "transpose":
        if len(ident) < 4:
            return ident
        i = rng.randrange(1, len(ident) - 2)
        return ident[:i] + ident[i + 1] + ident[i] + ident[i + 2:]
    return ident


# ----------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------

def _file_records(corpus: str) -> list[dict]:
    path = CORPORA_DIR / corpus / "corpus.jsonl"
    if not path.exists():
        raise FileNotFoundError(f"missing corpus.jsonl: {path}")
    return list(read_jsonl(path))


def _corpus_root(corpus: str) -> Path:
    """Find the on-disk root for this corpus (for `git log` of commit_msg)."""
    direct = CORPORA_DIR / corpus / "repo"
    if direct.exists():
        return direct
    # Local-path corpora are mapped from the SPECS in 00_collect_corpus.
    HOST_PYPROJ = Path(r"E:\pythonproject")
    candidates = {
        "coding-agent": HOST_PYPROJ / "coding-agent",
        "MiMo-Code":    HOST_PYPROJ / "MiMo-Code",
    }
    return candidates.get(corpus, CORPORA_DIR / corpus)


def derive_for_corpus(corpus: str) -> dict[str, int]:
    log(f"=== deriving queries: {corpus} ===")
    recs = _file_records(corpus)
    # Pre-extract all files (one pass).
    extracted: dict[str, dict] = {}
    for rec in recs:
        extracted[rec["rel_path"]] = extract(rec["language"], rec["content"])

    all_paths = {r["rel_path"]: r["file_id"] for r in recs}

    families: dict[str, list[dict]] = {}
    families["func_name"]     = build_func_name(recs, extracted)
    families["docstring"]     = build_docstring(recs, extracted)
    families["test_name"]     = build_test_name(recs, extracted, all_paths)
    families["call_site"]     = build_call_site(recs, extracted)
    families["import_target"] = build_import_target(recs, extracted, all_paths)
    try:
        families["commit_msg"] = build_commit_msg(recs, _corpus_root(corpus))
    except Exception as e:
        log(f"  commit_msg failed: {e}")
        families["commit_msg"] = []
    families["mutated_id"]    = build_mutated_id(families["func_name"])

    # Dedup + cap + finalize.
    rng = random.Random(42)
    out_rows: list[dict] = []
    stats: dict[str, int] = {}
    for fam, rows in families.items():
        # Dedup by (query, target_id).
        seen: set[tuple[str, str]] = set()
        unique: list[dict] = []
        for r in rows:
            key = (r["query"], r["target_id"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
        # Cap.
        if len(unique) > MAX_PER_FAMILY:
            rng.shuffle(unique)
            unique = unique[:MAX_PER_FAMILY]
        for r in unique:
            r["corpus"] = corpus
            r["query_id"] = short_id(corpus, fam, r["query"], r["target_id"])
        stats[fam] = len(unique)
        out_rows.extend(unique)

    out_path = QUERIES_DIR / f"{corpus}.queries.jsonl"
    n = write_jsonl(out_path, out_rows)
    log(f"{corpus}: {n} queries → {out_path}")
    for fam, k in stats.items():
        log(f"  {fam:14s} {k}")
    return stats


def main() -> int:
    selection = sys.argv[1:]
    if not selection:
        selection = [p.parent.name for p in CORPORA_DIR.glob("*/corpus.jsonl")]
    if not selection:
        log("no corpora found; run 00_collect_corpus.py first")
        return 2
    total: dict[str, dict[str, int]] = {}
    for corpus in selection:
        try:
            total[corpus] = derive_for_corpus(corpus)
        except Exception as e:
            log(f"!! {corpus} failed: {e}")
            total[corpus] = {"error": str(e)}
    log("=== summary ===")
    for c, s in total.items():
        log(f"  {c}: {sum(v for v in s.values() if isinstance(v, int))} queries"
            f"  per-family={s}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
