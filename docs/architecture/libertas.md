# Libertas 架构

Libertas 是 Aevum 的领域与安全层，按变化原因分层：

- `foundation`：配置、终端、缓存、限流、重试、指标、健康、计时。
- `identity`：用户、会话、许可证、子账号、身份档案。
- `observability`：通知中心、邮件/Webhook 通道、通知模型。
- `data`：备份、系统设置、白板、日记、快速笔记。
- `tools`：工具治理、插件、搜索、WAN 分享、二进制执行。
- `release`：发布密钥、版本产物、安装器、发布索引。
- `security`：隐私、合规、规则、漏洞情报、旧安全模块。
- `models/legacy_models`：旧模型引擎迁入，独立于当前 Web 主链路。

## 依赖方向

适配层（`apps/console/monitor`）可以依赖领域层；领域层不得反向导入 `apps/`。兼容入口只做 re-export，不复制实现。

## 本轮拆分

`identity/user/storage.py` 拆出 `loop_storage.py`，让账号库和回路库各自有清晰边界；`notifications/models.py` 补齐 `datetime` 导入，修复订阅提醒在构造通知对象时直接抛异常的问题。
