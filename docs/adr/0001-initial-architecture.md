# ADR 0001：初始架构

## 决定

Aevum 采用“静态呈现 + 本地监控 API + 纯内存中继 + 独立内核”的结构。展示页和多窗口看板放在 `interface/web`，由 `desktop_server.py` 在根路径提供；中继 `command/relay` 不落盘；模型和安全能力放在 `src/architecture/libertas` 与 `src/architecture/memoria`，按需从入口加载。

## 原因

- 页面与内核解耦，任意一段重启不会把整个站点带走。
- 中继只保存会话和上下文，减少隐私面与部署成本。
- 订阅、账号、许可证各自使用独立存储，避免把报名名单和账号库混在一起。

## 后果

入口文件不应继续承载业务细节。新增能力先进对应的 `api/`、`monitor_*` 或领域模块，再由入口组合。
