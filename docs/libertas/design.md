# Libertas 设计

Libertas 的核心不是“功能越多越好”，而是把身份、数据、工具、发布和安全边界分开。`foundation` 提供可复用基础件；`identity` 管理账号、会话与许可证；`observability` 负责通知；`data` 负责持久化；`tools` 负责工具治理；`release` 负责产物；`security` 负责规则与防护。

旧模块通过 `legacy_*` 目录迁入，保留兼容入口但不再扩散新依赖。每个新能力必须能说清：谁调用、写哪个库、失败如何表现。
