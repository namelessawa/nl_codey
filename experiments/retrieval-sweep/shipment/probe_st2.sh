#!/bin/bash
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
echo "[probe2] mirror only..."
timeout 90 python3 -c "
import os, time
print('endpoint=', os.environ.get('HF_ENDPOINT'))
t0 = time.time()
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cuda')
print(f'load ok in {time.time()-t0:.1f}s')
v = m.encode(['hello','world'])
print(f'encode ok shape={v.shape}')
" 2>&1
echo "[probe2] EXIT=$?"
