"""Pack the experiment into a self-contained shipment for the GPU server.

What goes in:
  - All scripts/*.py (the BM25, hybrid, dense, eval, sweep drivers).
  - All corpora/*/corpus.jsonl + meta.json   (NOT the raw git repos —
    they're ~500MB.  The JSONL is the canonical, deterministic form.)
  - All queries/*.jsonl                       (so dense / hybrid sweeps
    have queries pre-derived; no need to re-parse on the remote.)
  - DESIGN.md (the spec the remote runs against).
  - requirements_gpu.txt + run_remote.sh.

What does NOT go in:
  - corpora/*/repo/ (re-clonable from the meta.json git_sha).
  - results/  (the remote PRODUCES these).
  - .git, __pycache__.

Output:
  shipment/<timestamp>.tar.gz

Send with:
  pscp -P 25711 -pw wjb123456 shipment/<file>.tar.gz \
       root@10.115.7.6:/opt/data/private/Wangjb/agent/

Then SSH and run:
  cd /opt/data/private/Wangjb/agent
  tar -xzf <file>.tar.gz
  bash run_remote.sh
"""
from __future__ import annotations

import datetime
import os
import sys
import tarfile
from pathlib import Path

from _common import CORPORA_DIR, QUERIES_DIR, ROOT


SHIP_DIR = ROOT / "shipment"


REQUIREMENTS_TXT = """\
# GPU server dependencies for D4/E4.
torch>=2.2
sentence-transformers>=2.6
numpy>=1.26
"""

RUN_REMOTE_SH = """\
#!/usr/bin/env bash
# Drop-in remote runner. Assumes:
#   - cwd is the unpacked shipment root
#   - python3 with pip is available
#   - one GPU (CUDA_VISIBLE_DEVICES=0 implicit) or CPU fallback
set -euo pipefail

# 0. Environment.
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
echo "[run_remote] cwd=$HERE"
python3 -V
nvidia-smi -L || echo "[run_remote] no GPU detected; will fall back to CPU"

# 1. Install deps into a local venv to avoid touching system Python.
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements_gpu.txt

# 2. Sanity smoke check on the mock embedder.
cd scripts
python3 -m unittest test_hybrid -v

# 3. D4 — encode every corpus with every pre-registered ST model, cache embeddings.
# 4. E4 — score every (corpus × model × query) → JSONL.
# 5. E5 — hybrid (BM25 best × dense best × {RRF, weighted, comb}) → JSONL.
# 6. E6 — query noise sweep.

python3 E4_dense_models.py 2>&1 | tee ../results/E4.log
python3 E5_hybrid_fusion.py 2>&1 | tee ../results/E5.log
python3 E6_query_noise.py   2>&1 | tee ../results/E6.log

echo "[run_remote] DONE. Results are under ../results/ ; tar them and pscp back:"
echo "  cd $HERE && tar -czf results_$(date +%Y%m%d_%H%M).tar.gz results/"
"""


SKIP_FILE_NAMES = {".pyc", ".pyo", "__pycache__"}


def pack(out: Path) -> int:
    SHIP_DIR.mkdir(parents=True, exist_ok=True)
    added = 0
    with tarfile.open(out, "w:gz") as tar:
        # Scripts.
        scripts_dir = ROOT / "scripts"
        for p in scripts_dir.iterdir():
            if p.is_dir() and p.name in SKIP_FILE_NAMES:
                continue
            if p.is_file() and (p.suffix in (".py", ".sh") or p.name in ("requirements_gpu.txt",)):
                tar.add(p, arcname=f"scripts/{p.name}")
                added += 1
        # Corpus JSONL + meta.
        for corpus_dir in CORPORA_DIR.iterdir():
            if not corpus_dir.is_dir():
                continue
            if corpus_dir.name.startswith("_"):
                continue
            for fname in ("corpus.jsonl", "meta.json"):
                src = corpus_dir / fname
                if src.exists():
                    tar.add(src, arcname=f"corpora/{corpus_dir.name}/{fname}")
                    added += 1
        # Queries.
        for q in QUERIES_DIR.glob("*.queries.jsonl"):
            tar.add(q, arcname=f"queries/{q.name}")
            added += 1
        # Design + ship-time helpers.
        for top in ("DESIGN.md",):
            src = ROOT / top
            if src.exists():
                tar.add(src, arcname=top)
                added += 1
        # Manifests.
        req = SHIP_DIR / "requirements_gpu.txt.staging"
        req.write_text(REQUIREMENTS_TXT, encoding="utf-8")
        tar.add(req, arcname="requirements_gpu.txt")
        req.unlink()
        run = SHIP_DIR / "run_remote.sh.staging"
        run.write_text(RUN_REMOTE_SH, encoding="utf-8")
        tar.add(run, arcname="run_remote.sh")
        run.unlink()
    return added


def main() -> int:
    ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out = SHIP_DIR / f"retrieval-sweep-{ts}.tar.gz"
    n = pack(out)
    size_mb = out.stat().st_size / 1024 / 1024
    print(f"[ship] wrote {out} ({size_mb:.1f} MB, {n} files)")
    print("[ship] upload:")
    print(f"  pscp -P 25711 -pw wjb123456 \"{out}\" "
          f"root@10.115.7.6:/opt/data/private/Wangjb/agent/")
    print("[ship] then on the server:")
    print("  cd /opt/data/private/Wangjb/agent")
    print(f"  mkdir -p sweep && cd sweep && tar -xzf ../{out.name}")
    print("  bash run_remote.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
