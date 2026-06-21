#!/bin/bash
# E4 subsample on MiMo + cpython (the slow corpora). coding-agent has full data.
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
export TRANSFORMERS_OFFLINE=1
export HF_HUB_OFFLINE=1
echo "[E4sub] subsample sweep — MiMo + cpython, 4 models, 1500 q each"
python3 E4_subsample.py --corpora MiMo-Code cpython-lib 2>&1
echo "[E4sub] DONE"
