#!/bin/bash
export HF_ENDPOINT=https://hf-mirror.com
timeout 120 python3 << 'PY' 2>&1
import time
print("[gpu] starting")
t0=time.time()
import torch
print(f"[gpu] torch imported in {time.time()-t0:.1f}s")
print(f"[gpu] cuda available: {torch.cuda.is_available()}")
t1=time.time()
torch.cuda.init()
print(f"[gpu] cuda init in {time.time()-t1:.1f}s")
t2=time.time()
x = torch.zeros(10, device='cuda')
print(f"[gpu] tensor alloc in {time.time()-t2:.1f}s")
from sentence_transformers import SentenceTransformer
t3=time.time()
m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cuda')
print(f"[gpu] loaded on GPU in {time.time()-t3:.1f}s")
t4=time.time()
v = m.encode(['hello world'])
print(f"[gpu] encoded in {time.time()-t4:.1f}s shape={v.shape}")
PY
echo "EXIT=$?"
