# command：统一指挥态

`command/` 不是第四个核心，只是三核心的指挥层。

- `contract.py`：`CoreSpec`、`CoreStatus`、`CoreKind`。
- `registry.py`：登记 `kernel`、`architecture`、`engine`。
- `supervisor.py`：`multiprocessing` 的启动、停止、轮询骨架。
- `relay/`：纯内存中继。

## 边界

- 不 import `libertas`、`fortuna` 或 `memoria`；核心由调用方传入模块级入口函数。
- 不写业务状态，不读数据库，不发邮件。
- 任何跨核心消息都走 `contract.py` 的状态契约，不直接调用对方内部函数。

## 启动中继

```bash
cd command/relay
python -m relay --port 8790
```
