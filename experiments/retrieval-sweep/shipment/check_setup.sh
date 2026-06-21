#!/bin/bash
echo "[check] running processes:"
ps -ef | grep -E 'bash|python3|pip|setup_pip' | grep -v grep | head -10
echo "[check] is torch installed?"
python3 -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available())' 2>&1 | head -3
echo "[check] is ST installed?"
python3 -c 'import sentence_transformers as s; print("ST", s.__version__)' 2>&1 | head -3
echo "[check] disk free:"
df -h / | tail -1
echo "[check] pip cache size:"
du -sh /root/.cache/pip 2>/dev/null
