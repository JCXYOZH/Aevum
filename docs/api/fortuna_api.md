# Fortuna API

`src/fortuna` 目前是内核方向骨架，没有稳定的对外 HTTP API。已有 `boot`、`core`、`arch`、`memory`、`scheduler`、`vfs`、`net`、`sandbox` 等目录，主要用于后续内核设计、单元测试和接口演练。

在 API 定稿前，不要把它写进公开客户端契约。需要联调时，直接引用 Python 模块或测试夹具，并在 `docs/fortuna/design.md` 记录假设。
