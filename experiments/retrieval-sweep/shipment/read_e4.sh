#!/bin/bash
python3 << 'PY'
import json, glob
for p in sorted(glob.glob('/opt/data/private/Wangjb/agent/sweep/results/E4/*.summary.json')):
    s = json.load(open(p))
    c = s['config']
    print(f'{c["corpus"]:14s} {c["dense_model"]:50s}  MRR={s["mrr"]:.4f}  H@1={s["hit_at_1"]:.4f}  H@10={s["hit_at_10"]:.4f}')
PY
