#!/bin/bash
export HF_ENDPOINT=https://hf-mirror.com
timeout 90 python3 << 'PY' 2>&1
import time
print("[t0] starting imports")
t0 = time.time()
from sentence_transformers import SentenceTransformer
print(f"[t0] ST imported in {time.time()-t0:.1f}s")
t1 = time.time()
m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
print(f"[t0] loaded on CPU in {time.time()-t1:.1f}s")
t2 = time.time()
v = m.encode(['hello world'])
print(f"[t0] encoded in {time.time()-t2:.1f}s shape={v.shape}")
PY
echo "EXIT=$?"
