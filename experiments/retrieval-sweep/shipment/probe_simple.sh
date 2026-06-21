#!/bin/bash
export TRANSFORMERS_OFFLINE=1
export HF_HUB_OFFLINE=1
export HF_ENDPOINT=https://hf-mirror.com
export CUDA_VISIBLE_DEVICES=""
export HF_HUB_DOWNLOAD_TIMEOUT=5
echo "[simple] start"
timeout 30 python3 << 'PY' 2>&1
import sys, os, time
print(f"[simple] python {sys.version.split()[0]}", flush=True)
t = time.time()
print("[simple] importing torch...", flush=True)
import torch
print(f"[simple] torch ok in {time.time()-t:.1f}s cuda={torch.cuda.is_available()}", flush=True)
t = time.time()
print("[simple] importing ST...", flush=True)
from sentence_transformers import SentenceTransformer
print(f"[simple] ST ok in {time.time()-t:.1f}s", flush=True)
t = time.time()
print("[simple] loading model...", flush=True)
m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
print(f"[simple] model ok in {time.time()-t:.1f}s", flush=True)
PY
echo "EXIT=$?"
