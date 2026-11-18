# archive：归档层

`archive/` 只放“保留可查、但不在新运行路径”的代码。

- `backend-python/monitor/`：原 `apps/console/monitor`，已放弃的 Python 业务后端。
- 归档代码不参与新目录的 import 图，不接新功能。
- 需要恢复某段能力时，先把它重写进三个核心之一，而不是直接改归档代码。
