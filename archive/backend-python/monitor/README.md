# 监控服务

`desktop_server.py` 是本地监控与身份 API 的入口，默认监听 `127.0.0.1:8781`。

## 文件分工

| 文件 | 职责 |
| --- | --- |
| `desktop_server.py` | CLI、Handler 组合、启动 |
| `monitor_config.py` | 路径、模型可执行文件、聊天工具定义 |
| `monitor_payloads.py` | 指标、检查点、模型、错误码、健康投影 |
| `monitor_http.py` | HTTP 路由、静态资源、鉴权与委派 |
| `monitor_chat.py` | 本地/云端对话与工具调用 |
| `auth_api.py` | 会话、cookie、分发、FastAPI 工厂 |
| `auth_loop.py` | `/api/loop/*` |
| `auth_account.py` | `/api/auth/*` |
| `api/` | FastAPI 路由与请求模型 |

## 启动

```powershell
$env:PYTHONPATH = "D:\Aevum\src"
D:\venv\Scripts\python.exe apps\console\monitor\desktop_server.py --port 8781
```

根路径 `/` 返回展示页，`/desktop` 返回 3D 桌面。API 默认只对本机开放。
