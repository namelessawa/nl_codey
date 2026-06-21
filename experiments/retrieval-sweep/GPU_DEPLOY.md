# GPU 部署说明 — 一次性手动步骤

> 本机自动化失败原因:Windows OpenSSH/PuTTY 的 hostkey 接受 prompt 与
> 密码输入都需要交互式终端,在 Git Bash + Claude 子进程环境下无法非
> 交互地完成。最干净的方案是用户手动跑下面 3 行,把 shipment 上传一次。

## Step 0 — 已就绪的本地产物

- 部署包: `experiments/retrieval-sweep/shipment/retrieval-sweep-20260612T165326Z.tar.gz` (13.2 MB, 34 个文件)
- 内含: 所有 `_*.py` / `E*.py` / `F_*.py` 脚本 + 4 个 corpora 的 `corpus.jsonl` + 4 个 corpora 的 `queries.jsonl` + DESIGN.md + `run_remote.sh` + `requirements_gpu.txt`
- 不含: git 历史、原始仓库、本地 results(远端自己生成)。

## Step 1 — 上传到 GPU 服务器(PowerShell 或新终端)

```powershell
# Windows PowerShell:
& "C:\Program Files\PuTTY\pscp.exe" -P 25711 -pw wjb123456 `
    "E:\pythonproject\coding-agent\experiments\retrieval-sweep\shipment\retrieval-sweep-20260612T165326Z.tar.gz" `
    root@10.115.7.6:/opt/data/private/Wangjb/agent/
```

或 PuTTY 不在 PATH 时:

```
"C:\Program Files\PuTTY\pscp.exe" -P 25711 -pw wjb123456 ...
```

第一次会问 hostkey:输入 `y` 接受。

## Step 2 — SSH 上去解包并启动(同一终端,新会话亦可)

```powershell
& "C:\Program Files\PuTTY\plink.exe" -ssh -P 25711 -pw wjb123456 root@10.115.7.6
```

进入远端后:

```bash
mkdir -p /opt/data/private/Wangjb/agent
cd /opt/data/private/Wangjb/agent
mkdir -p sweep && cd sweep
tar -xzf ../retrieval-sweep-20260612T165326Z.tar.gz
bash run_remote.sh 2>&1 | tee run.log
```

`run_remote.sh` 做的事(自动):
1. 创建 .venv, `pip install -r requirements_gpu.txt`
2. `python -m unittest test_hybrid` 烟测
3. **E4** — 9 个 sentence-transformer 模型 × 4 corpora,编码 + 评测,缓存 embeddings
4. **E5** — BM25 best (来自上传的 E1 INDEX) × dense best (E4) × 16 fusion configs
5. **E6** real-dense 部分(可选)

预估耗时:第一次模型下载 ~30 min(取决于网络);全部 sweep 在单卡 A100/3090 上 ~1-3 小时。

## Step 3 — 取回结果

远端结束后:

```powershell
& "C:\Program Files\PuTTY\pscp.exe" -P 25711 -pw wjb123456 `
    root@10.115.7.6:/opt/data/private/Wangjb/agent/sweep/results_*.tar.gz `
    "E:\pythonproject\coding-agent\experiments\retrieval-sweep\results\"
```

或在远端:

```bash
cd /opt/data/private/Wangjb/agent/sweep
tar -czf results_$(date +%Y%m%d_%H%M).tar.gz results/
```

然后下载并解到本地的 `experiments/retrieval-sweep/results/` 里,
本地 `python scripts/F_analyze.py` 自动合并 E4/E5 进 MASTER.csv +
绘制 plots/。

## 检查清单

- [ ] pscp 上传完成,远端 ls 看到 tar.gz
- [ ] tar -xzf 完成,看到 `scripts/`, `corpora/`, `queries/`
- [ ] `bash run_remote.sh` 启动,无 import error
- [ ] `nvidia-smi` 在远端能看到 GPU
- [ ] sentence-transformers 第一次下载成功
- [ ] E4 INDEX.csv 落盘 (`/opt/data/private/Wangjb/agent/sweep/results/E4/INDEX.csv`)
- [ ] E5 INDEX.csv 落盘
- [ ] 把 `results/` 打包回传到本地

## 失败兜底

如果 GPU/网络问题导致 sentence-transformers 不可用,可以用 mock 模式跑通管线(产出不是真数据但能验证脚本):

```bash
python3 scripts/E4_dense_models.py --mock
python3 scripts/E5_hybrid_fusion.py --mock
```

mock 结果只能用于"管线对不对"判断,不能写进 REPORT.md / PAPER.md
的真实数据列。
