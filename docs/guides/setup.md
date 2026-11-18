# 本地安装

Windows 本地：

```powershell
cd D:\Aevum
D:\venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHONPATH = "D:\Aevum\src"
python archive\backend-python\monitor\desktop_server.py --port 8781
```

打开 `http://127.0.0.1:8781/` 是展示页；`http://127.0.0.1:8781/desktop` 是 3D 桌面。只起静态页可用 `8799`，但订阅 API 在 `8781`。

数据目录由 `LIBERTAS_DATA_DIR` 决定；本地常用 `D:\LibertasData\AevumData`。`mail.json`、`loop.key` 和 `loop.pepper` 都在该目录的 `config/` 下。
