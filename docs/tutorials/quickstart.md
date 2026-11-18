# 快速开始

```powershell
cd D:\Aevum
$env:PYTHONPATH = "D:\Aevum\src"
D:\venv\Scripts\python.exe archive\backend-python\monitor\desktop_server.py --port 8781
```

- 展示页：`http://127.0.0.1:8781/`
- 3D 桌面：`http://127.0.0.1:8781/desktop`
- 健康检查：`http://127.0.0.1:8781/api/health`

需要中继时再起 `control/relay`；需要串口时再起 `src/kernel/host/bridge`。三段可以独立启动。
