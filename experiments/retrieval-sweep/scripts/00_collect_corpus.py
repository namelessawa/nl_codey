"""Collect the four pre-registered corpora into normalized JSONL.

Each corpus produces `corpora/<name>/corpus.jsonl` with one row per file:

    {
      "file_id":  "abcdef0123456789",   # short_id(corpus_name, rel_path)
      "corpus":   "coding-agent",
      "rel_path": "packages/memory/src/retriever.ts",
      "language": "typescript",
      "sha256":   "<hex>",
      "n_bytes":  4242,
      "n_lines":  142,
      "content":  "..."
    }

Plus a `corpora/<name>/meta.json` capturing the git SHA + collection stats
(critical for reproducibility — the same SHA must yield the same JSONL).

Usage:
    python scripts/00_collect_corpus.py             # all 4
    python scripts/00_collect_corpus.py coding-agent MiMo-Code  # subset
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

from _common import (
    CORPORA_DIR,
    CorpusSpec,
    keep_under_prefix,
    language_of,
    log,
    read_text_or_none,
    sha256_text,
    short_id,
    walk_source_files,
    write_jsonl,
)


# ---------------------------------------------------------------- specs

# Two corpora are already cloned on this developer machine; we point at
# them directly to save bandwidth. The other two are cloned on demand.
HOST_PYPROJ = Path(r"E:\pythonproject")

SPECS: dict[str, CorpusSpec] = {
    "coding-agent": CorpusSpec(
        name="coding-agent",
        local_path=HOST_PYPROJ / "coding-agent",
        git_url=None,
        git_rev=None,
        languages=("typescript",),
        max_files=15_000,
        max_bytes=30 * 1024 * 1024,
        # Skip our own experiments/ tree so the queries can't trivially
        # find themselves in the corpus.
        keep_prefix=("packages", "apps"),
    ),
    "MiMo-Code": CorpusSpec(
        name="MiMo-Code",
        local_path=HOST_PYPROJ / "MiMo-Code",
        git_url=None,
        git_rev=None,
        languages=("typescript",),
        max_files=15_000,
        max_bytes=30 * 1024 * 1024,
        keep_prefix=("packages",),
    ),
    "cpython-lib": CorpusSpec(
        name="cpython-lib",
        local_path=None,
        git_url="https://github.com/python/cpython.git",
        # Pinned tag for reproducibility (a recent stable Python release).
        git_rev="v3.12.7",
        languages=("python",),
        max_files=10_000,
        max_bytes=30 * 1024 * 1024,
        keep_prefix=("Lib",),
    ),
    "etcd": CorpusSpec(
        name="etcd",
        local_path=None,
        git_url="https://github.com/etcd-io/etcd.git",
        git_rev="v3.5.16",
        languages=("go",),
        max_files=15_000,
        max_bytes=30 * 1024 * 1024,
        keep_prefix=(),
    ),
}


# ---------------------------------------------------------------- git clone

def _run(args: list[str], cwd: Path | None = None) -> str:
    log(f"$ {' '.join(args)}")
    p = subprocess.run(
        args,
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    if p.returncode != 0:
        sys.stderr.write(p.stderr)
        raise RuntimeError(f"command failed (exit {p.returncode}): {' '.join(args)}")
    return p.stdout.strip()


def ensure_clone(spec: CorpusSpec, retries: int = 3) -> Path:
    """Materialise the corpus working tree; return its root.

    Resilient against:
      - Transient network failures during clone (bounded retry).
      - Pinned `git_rev` being a tag that wasn't fetched yet (fetch tags
        + retry checkout).
    """
    if spec.local_path is not None:
        if not spec.local_path.exists():
            raise FileNotFoundError(f"{spec.name}: local_path missing: {spec.local_path}")
        return spec.local_path
    assert spec.git_url and spec.git_rev
    dest = CORPORA_DIR / spec.name / "repo"

    if not (dest / ".git").exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        last_err: Exception | None = None
        for attempt in range(1, retries + 1):
            try:
                _run(["git", "clone", "--filter=blob:none",
                      spec.git_url, str(dest)])
                last_err = None
                break
            except Exception as e:
                last_err = e
                log(f"{spec.name}: clone attempt {attempt}/{retries} failed: {e}")
                # Remove any half-written dir before retrying.
                import shutil
                if dest.exists():
                    shutil.rmtree(dest, ignore_errors=True)
        if last_err:
            raise last_err
    else:
        log(f"{spec.name}: already cloned at {dest}")

    # Checkout the pinned rev. If the rev is a tag that wasn't fetched
    # yet, pull tags and try again before giving up.
    try:
        _run(["git", "checkout", "--quiet", spec.git_rev], cwd=dest)
    except Exception:
        log(f"{spec.name}: rev {spec.git_rev} unknown locally — fetching tags…")
        _run(["git", "fetch", "--tags", "--quiet"], cwd=dest)
        _run(["git", "checkout", "--quiet", spec.git_rev], cwd=dest)
    return dest


def git_sha(repo: Path) -> str:
    try:
        return _run(["git", "rev-parse", "HEAD"], cwd=repo)
    except Exception:
        return "unknown"


# ---------------------------------------------------------------- collect

def collect_corpus(spec: CorpusSpec) -> dict[str, int | str]:
    log(f"=== collecting {spec.name} ===")
    out_dir = CORPORA_DIR / spec.name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_jsonl = out_dir / "corpus.jsonl"
    out_meta = out_dir / "meta.json"

    root = ensure_clone(spec)
    sha = git_sha(root)

    files = walk_source_files(root, spec.languages)
    log(f"{spec.name}: {len(files)} candidate files in {root}")

    rows: list[dict] = []
    bytes_written = 0
    files_written = 0
    skipped_prefix = 0
    skipped_binary = 0
    skipped_size = 0

    for fp in files:
        if files_written >= spec.max_files:
            break
        if bytes_written >= spec.max_bytes:
            break
        rel = fp.relative_to(root).as_posix()
        if not keep_under_prefix(rel, spec.keep_prefix):
            skipped_prefix += 1
            continue
        text = read_text_or_none(fp)
        if text is None:
            skipped_binary += 1
            continue
        nb = len(text.encode("utf-8"))
        if bytes_written + nb > spec.max_bytes:
            skipped_size += 1
            continue
        row = {
            "file_id":  short_id(spec.name, rel),
            "corpus":   spec.name,
            "rel_path": rel,
            "language": language_of(fp),
            "sha256":   sha256_text(text),
            "n_bytes":  nb,
            "n_lines":  text.count("\n") + 1,
            "content":  text,
        }
        rows.append(row)
        bytes_written += nb
        files_written += 1

    n = write_jsonl(out_jsonl, rows)
    stats = {
        "corpus":         spec.name,
        "git_sha":        sha,
        "git_rev_spec":   spec.git_rev or "(local)",
        "files_written":  n,
        "bytes_written":  bytes_written,
        "candidates":     len(files),
        "skipped_prefix": skipped_prefix,
        "skipped_binary": skipped_binary,
        "skipped_size":   skipped_size,
        "max_files":      spec.max_files,
        "max_bytes":      spec.max_bytes,
        "languages":      list(spec.languages),
        "keep_prefix":    list(spec.keep_prefix),
        "out":            str(out_jsonl.relative_to(out_dir.parent.parent)),
        "collected_at":   int(time.time()),
    }
    out_meta.write_text(
        json.dumps(stats, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log(f"{spec.name}: wrote {n} files ({bytes_written/1024:.1f} KiB) → {out_jsonl}")
    return stats


# ---------------------------------------------------------------- main

def main() -> int:
    selection = sys.argv[1:]
    if not selection:
        selection = list(SPECS.keys())
    unknown = [s for s in selection if s not in SPECS]
    if unknown:
        sys.stderr.write(f"unknown corpus name(s): {unknown}\n")
        sys.stderr.write(f"known: {sorted(SPECS)}\n")
        return 2

    summary: list[dict] = []
    for name in selection:
        try:
            stats = collect_corpus(SPECS[name])
            summary.append(stats)
        except Exception as e:
            log(f"!! {name} failed: {e}")
            summary.append({"corpus": name, "error": str(e)})

    log("=== summary ===")
    for s in summary:
        if "error" in s:
            log(f"  {s['corpus']:20s} FAILED: {s['error']}")
        else:
            log(f"  {s['corpus']:20s}  files={s['files_written']:>6}"
                f"  bytes={s['bytes_written']:>10}  sha={s['git_sha'][:10]}")
    # Persist a top-level index for downstream scripts.
    idx = CORPORA_DIR / "INDEX.json"
    idx.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"index → {idx}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
