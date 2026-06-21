#!/bin/bash
# Run E4 on CPU only — GPU context is stuck from leaked process 2326028.
# Skip etcd (already done on GPU); cover the other 3 corpora × 7 models.
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
export TRANSFORMERS_OFFLINE=1
export HF_HUB_OFFLINE=1
export CUDA_VISIBLE_DEVICES=""
echo "[E4cpu] CPU-only sweep (GPU context stuck)"
python3 E4_batched.py \
  --corpora coding-agent MiMo-Code cpython-lib \
  --models \
    sentence-transformers/all-MiniLM-L6-v2 \
    sentence-transformers/all-MiniLM-L12-v2 \
    sentence-transformers/all-mpnet-base-v2 \
    BAAI/bge-small-en-v1.5 \
    BAAI/bge-base-en-v1.5 \
    intfloat/e5-small-v2 \
    intfloat/e5-base-v2 \
  2>&1
echo "[E4cpu] DONE"
