#!/bin/bash
# Run E4 on the small corpus first (smoke), then full 9-model × 4-corpus sweep.
# Models pull from HuggingFace; cache lives in ~/.cache/huggingface/hub.
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_HUB_DOWNLOAD_TIMEOUT=60
# Use HF mirror if available (mainland)
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
echo "[E4] HF_ENDPOINT=$HF_ENDPOINT"
echo "[E4] Smoke: 1 model × 1 corpus"
python3 E4_dense_models.py --models sentence-transformers/all-MiniLM-L6-v2 --corpora coding-agent 2>&1 | tail -10 || true
echo "[E4] === full sweep (9 models × 4 corpora) ==="
python3 E4_dense_models.py 2>&1
echo "[E4] DONE"
