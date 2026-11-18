# Memoria 在整体架构里的位置

```text
浏览器 / Electron
   │  HTTP + WebSocket
   ▼
interface/web        展示页、看板（静态文件，可 nginx 托管）
archive/backend-python/monitor      /api/model、/api/trainer、/api/errors、/api/health
command/relay                纯内存中继：会话、上下文、分片
src/kernel/host/bridge       串口帧 -> WebSocket
src/kernel/host/console       引导、状态机、错误码、80×25 单元格
   │
   ▼
src/architecture/memoria               C++ 训练/生成；由 monitor 作为子进程拉起
```

## 边界

- 页面不直接碰内核，也不直接读权重文件；只调监控 API。
- 监控只起本地 exe，不把训练逻辑写进 Python。
- 中继不保存对话内容；它和 Memoria 的记忆是两件事。
- `archive/backend-python/monitor/desktop_server.py` 是当前唯一“页面 -> 模型”的入口；云端接口以后也接在这里，不要让页面直连模型进程。

## 目录映射

| 旧工作区 | 开源仓库 |
| --- | --- |
| `src/*.cpp` | `src/architecture/memoria/*.cpp` |
| `src/architecture/memoria/include/*.h` | `src/architecture/memoria/include/*.h` |
| `interface/web` | `interface/web` |
| `archive/backend-python/monitor` | `archive/backend-python/monitor` |
| `interface/desktop` | `interface/desktop` |
| `data/tinyshakespeare_3000.txt` | `data/tinyshakespeare_3000.txt` |

`src/kernel/host/console`、`bridge`、`relay` 沿用开源仓库原有结构；本轮只把实际实现覆盖进去，不改变职责划分。
