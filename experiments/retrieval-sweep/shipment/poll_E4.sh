#!/bin/bash
echo "[poll] processes:"
ps -ef | grep -E 'E4|nohup|python3 E' | grep -v grep | head -5
echo "[poll] log size:"
wc -l /opt/data/private/Wangjb/agent/sweep/E4.log 2>/dev/null
echo "[poll] log tail:"
tail -25 /opt/data/private/Wangjb/agent/sweep/E4.log 2>/dev/null
echo "[poll] results so far:"
ls /opt/data/private/Wangjb/agent/sweep/results/E4/*.summary.json 2>/dev/null | wc -l
echo "[poll] GPU:"
nvidia-smi --query-gpu=name,utilization.gpu,memory.used --format=csv,noheader
