#!/bin/bash
set -e
echo "[setup] installing system pkgs"
apt-get update -qq 2>&1 | tail -2
apt-get install -y python3-distutils python3-pip 2>&1 | tail -3
which pip3 || which pip
python3 -m pip --version || pip3 --version
echo "[setup] upgrading pip"
python3 -m pip install --upgrade pip --quiet 2>&1 | tail -3 || pip3 install --upgrade pip --quiet 2>&1 | tail -3
echo "[setup] pip-installing torch + sentence-transformers"
python3 -m pip install torch==2.0.1 --index-url https://download.pytorch.org/whl/cu118 --quiet 2>&1 | tail -5
echo "[setup] verify torch"
python3 -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "device", torch.cuda.get_device_name(0) if torch.cuda.is_available() else None)'
python3 -m pip install sentence-transformers numpy --quiet 2>&1 | tail -5
echo "[setup] verify ST"
python3 -c 'from sentence_transformers import SentenceTransformer; import sentence_transformers as s; print("ST", s.__version__)'
echo "[setup] DONE"
