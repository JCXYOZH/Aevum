# API 参考索引

本文件是索引，不复制每个路由的完整字段。FastAPI 工厂位于 `apps/console/monitor/auth_api.py` 的 `create_fastapi_app`，路由按领域拆在 `apps/console/monitor/api/`：

- `loop.py`：订阅、确认、退订、来源、墙、导出。
- `governance.py`：治理只读状态、提案、分叉、门槛。
- `visitor.py`：访客初始化与社区概览。
- `system.py`：健康检查。
- `capabilities.py`：能力清单。

字段以 Pydantic 模型和路由函数签名为准；新增路由必须同时补本页索引和至少一个请求示例。
