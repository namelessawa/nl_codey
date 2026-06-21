"""Integrate downloaded GPU results (E4 + E5) into local MASTER.csv.

Usage:
    1. On the remote:  bash fetch_results.sh   (creates results_<ts>.tar.gz)
    2. Local pscp to ./shipment/.
    3. python integrate_gpu.py shipment/results_<ts>.tar.gz

Steps:
  - Extract under results_remote/ (transient, gitignored)
  - Copy E4/ and E5/ subdirs into local results/.
  - Re-run F_analyze.
"""
from __future__ import annotations

import shutil
import sys
import tarfile
from pathlib import Path

from _common import RESULTS_DIR, ROOT, log


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    tarball = Path(sys.argv[1]).resolve()
    if not tarball.exists():
        log(f"no such tarball: {tarball}")
        return 1
    log(f"extracting {tarball}")
    staging = ROOT / "results_remote"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    with tarfile.open(tarball) as tar:
        tar.extractall(staging)
    # Find the actual results/ under staging
    cand = list(staging.rglob("results"))
    if not cand:
        log("no results/ dir inside tarball")
        return 1
    src = cand[0]
    log(f"merging from {src} → {RESULTS_DIR}")
    for stage_dir in src.iterdir():
        if not stage_dir.is_dir():
            continue
        if stage_dir.name not in ("E4", "E5"):
            log(f"  skip {stage_dir.name} (only E4/E5 are merged)")
            continue
        target = RESULTS_DIR / stage_dir.name
        target.mkdir(parents=True, exist_ok=True)
        n = 0
        for jf in stage_dir.glob("*.summary.json"):
            shutil.copy2(jf, target / jf.name)
            n += 1
        for rf in stage_dir.glob("*.rows.jsonl"):
            shutil.copy2(rf, target / rf.name)
        for idx in stage_dir.glob("INDEX.csv"):
            shutil.copy2(idx, target / idx.name)
        log(f"  {stage_dir.name}: copied {n} summaries")
    log("now run F_analyze.py to refresh MASTER + plots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
