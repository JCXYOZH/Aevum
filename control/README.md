# control：控制平面

`control/` 是三个核心运行时的控制平面（Control Plane）。它负责登记、启动、停止、状态轮询和消息转发，不承载任何业务逻辑。

- `contract.py`：`CoreSpec`、`CoreStatus`、`CoreKind`。
- `registry.py`：登记 `kernel`、`architecture`、`engine` 三个核心运行时。
- `supervisor.py`：基于 `multiprocessing` 的启动、停止、状态轮询。
- `relay/`：纯内存中继。

## 边界

- 不 import `libertas`、`fortuna` 或 `memoria`；核心由调用方传入模块级入口函数。
- 不写业务状态，不读数据库，不发邮件。
- 跨核心消息只走 `contract.py` 的状态契约，不直接调用对方内部函数。

## 启动中继

```bash
cd control/relay
python -m relay --port 8790
```
