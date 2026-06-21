#!/bin/bash
# Run E5 hybrid fusion sweep (reads E4 INDEX to pick the best dense per corpus).
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
echo "[E5] === hybrid fusion sweep ==="
python3 E5_hybrid_fusion.py 2>&1
echo "[E5] DONE"
