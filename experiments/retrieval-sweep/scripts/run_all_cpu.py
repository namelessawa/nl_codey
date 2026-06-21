"""Run every CPU sweep in order. Use after E1 finishes.

Order matters: E2/E3 read E1 summaries to pick the best per-corpus (k1, b).
E7 / E8 are independent. E6 is independent (literature defaults).

Usage:
    python scripts/run_all_cpu.py                # all corpora, all stages
    python scripts/run_all_cpu.py --stages E2 E6 # subset
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from _common import log


ORDER = ("E2", "E3", "E6", "E7", "E8")
HERE = Path(__file__).parent


def run_stage(stage: str, extra: list[str]) -> int:
    script = HERE / f"{stage}_*.py"
    matches = list(HERE.glob(f"{stage}_*.py"))
    if not matches:
        log(f"!! no script for stage {stage}")
        return 1
    script_path = matches[0]
    log(f"=== {stage}: launching {script_path.name} ===")
    t0 = time.perf_counter()
    p = subprocess.run([sys.executable, str(script_path), *extra],
                       cwd=HERE, check=False)
    dt = time.perf_counter() - t0
    log(f"=== {stage}: exit {p.returncode}  ({dt:.1f}s) ===")
    return p.returncode


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", nargs="*", default=list(ORDER))
    ap.add_argument("--corpora", nargs="*", default=[],
                    help="Passed through to each stage script.")
    args = ap.parse_args()
    failures: list[str] = []
    for stage in args.stages:
        rc = run_stage(stage, list(args.corpora))
        if rc != 0:
            failures.append(stage)
    log(f"DONE. failures={failures}")
    # Always run F to refresh MASTER + plots.
    rc = run_stage("F", [])
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
