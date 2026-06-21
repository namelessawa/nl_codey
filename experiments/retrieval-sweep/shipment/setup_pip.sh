#!/bin/bash
set -e
echo "[setup] downloading get-pip for Python 3.8 (legacy URL)"
curl -sSL https://bootstrap.pypa.io/pip/3.8/get-pip.py -o /tmp/get-pip.py
echo "[setup] installing pip"
python3 /tmp/get-pip.py --quiet 2>&1 | tail -5
python3 -m pip --version
echo "[setup] upgrading pip"
python3 -m pip install --upgrade pip --quiet 2>&1 | tail -3
echo "[setup] pip-installing torch + sentence-transformers (this may take 5-10 min)"
python3 -m pip install --quiet torch --index-url https://download.pytorch.org/whl/cu118 2>&1 | tail -5 || true
echo "[setup] verify torch"
python3 -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available())'
python3 -m pip install --quiet sentence-transformers numpy 2>&1 | tail -5
echo "[setup] verify ST"
python3 -c 'from sentence_transformers import SentenceTransformer; import sentence_transformers as s; print("ST", s.__version__)'
echo "[setup] DONE"
