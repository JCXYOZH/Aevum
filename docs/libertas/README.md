# Libertas

Libertas 是 Aevum 的领域与安全层。当前主链路实际使用的是：

- `libertas.identity.user`：账号、会话、回路订阅。
- `libertas.identity.auth_manager`：验证码、许可证、子账号。
- `libertas.observability.notifications`：通知中心与邮件通道。
- `libertas.foundation`：配置、终端、限流、缓存。
- `libertas.tools`：工具治理、搜索、WAN 分享。

目录里还有大量旧安全模块和实验模块；它们不一定被当前入口引用，审计中的“代码利用率”统计的就是这个差异。
