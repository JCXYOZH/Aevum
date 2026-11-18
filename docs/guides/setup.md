# 本地安装

Windows 本地：

```powershell
cd D:\Aevum
D:\venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PYTHONPATH = "D:\Aevum\src\kernel;D:\Aevum\src\architecture;D:\Aevum\src\shared"
```

只起静态页：

```powershell
cd interface\web
python -m http.server 8799
```

打开 `http://127.0.0.1:8799/index.html` 是展示页，`http://127.0.0.1:8799/desktop.html` 是 3D 桌面。

起中继：

```powershell
cd control\relay
python -m relay --port 8790
```

监控与模型后端已归档到 `archive/backend-python/monitor`，不再作为本地默认启动项。需要查旧行为时单独运行归档入口，不要把它接回主线。

数据目录由 `LIBERTAS_DATA_DIR` 决定；本地常用 `D:\LibertasData\AevumData`。旧订阅配置 `mail.json`、`loop.key`、`loop.pepper` 属于归档后端，当前主线不再生成。
