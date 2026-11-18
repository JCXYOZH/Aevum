# 纯内存中继

`command/relay` 提供不落盘的会话、上下文和流式分片中继，默认监听 `127.0.0.1:8790`。

- `relay/engine.py`：HTTP 装配与启动。
- `relay/memory.py`：短期会话与上下文，TTL、轮次和会话上限。
- `relay/transfer.py`：流式分片与缓冲，TTL 和总缓冲上限。
- `relay/server.py`：交流房间与请求处理。
- `relay/bootstrap.py`：启动自检、契约版本和模块装配。

重启会清空内存中的会话与分片，这是设计行为，不是数据丢失。中继不承担账号、订阅或长期存储。
