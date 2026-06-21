#!/bin/bash
# Tarball remote results/ and download to local. Run AFTER E4/E5 are done.
set -e
cd /opt/data/private/Wangjb/agent/sweep
ts=$(date +%Y%m%d_%H%M%S)
echo "[fetch] packing results"
tar -czf results_${ts}.tar.gz results/
ls -la results_${ts}.tar.gz
echo "[fetch] tarball ready: results_${ts}.tar.gz"
