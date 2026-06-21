#!/bin/bash
set -e
cd /opt/data/private/Wangjb/agent/sweep/scripts
echo "[remote] Python version:"
python3 -c 'import sys; print(sys.version)'
echo "[remote] compile check:"
python3 -m py_compile _common.py _bm25.py _tokenizers.py _hybrid.py _dense.py _eval.py _metrics.py _noise.py _extractors.py E1_bm25_grid.py E4_dense_models.py E5_hybrid_fusion.py F_analyze.py
echo "[remote] COMPILE_OK"
echo "[remote] pip status:"
python3 -m pip --version
echo "[remote] torch / sentence-transformers status:"
python3 -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available())' 2>&1 || echo "  torch not installed"
python3 -c 'import sentence_transformers; print("ST", sentence_transformers.__version__)' 2>&1 || echo "  ST not installed"
echo "[remote] disk:"
df -h /opt/data/private | tail -1
