#!/bin/bash
# Skip ALL HF network checks - use only what's already cached.
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
export TRANSFORMERS_OFFLINE=1
export HF_HUB_OFFLINE=1
export HF_DATASETS_OFFLINE=1
echo "[E4] OFFLINE 7-model sweep"
python3 E4_batched.py \
  --models \
    sentence-transformers/all-MiniLM-L6-v2 \
    sentence-transformers/all-MiniLM-L12-v2 \
    sentence-transformers/all-mpnet-base-v2 \
    BAAI/bge-small-en-v1.5 \
    BAAI/bge-base-en-v1.5 \
    intfloat/e5-small-v2 \
    intfloat/e5-base-v2 \
  2>&1
echo "[E4] DONE"
