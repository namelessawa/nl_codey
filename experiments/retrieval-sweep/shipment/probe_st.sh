#!/bin/bash
set -u
cd /opt/data/private/Wangjb/agent/sweep/scripts
export HF_ENDPOINT=https://hf-mirror.com
export TRANSFORMERS_OFFLINE=1
export HF_HUB_OFFLINE=1
echo "[probe] testing ST cache load..."
timeout 60 python3 -c "
import os
print('HF_ENDPOINT=', os.environ.get('HF_ENDPOINT'))
print('TRANSFORMERS_OFFLINE=', os.environ.get('TRANSFORMERS_OFFLINE'))
print('HF_HUB_OFFLINE=', os.environ.get('HF_HUB_OFFLINE'))
import time; t0 = time.time()
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cuda')
print(f'load ok in {time.time()-t0:.1f}s; dim={m.get_sentence_embedding_dimension()}')
v = m.encode(['hello world', 'foo bar'])
print(f'encode ok shape={v.shape}')
" 2>&1
echo "[probe] EXIT=$?"
