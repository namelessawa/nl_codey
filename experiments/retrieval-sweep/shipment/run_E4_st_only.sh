#!/bin/bash
# Skip unixcoder/codebert (not ST-native); only the 7 ST-aware models.
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
echo "[E4] ST-only 7-model sweep"
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
