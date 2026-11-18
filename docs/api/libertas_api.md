# Libertas API

Libertas 的公开面分为 Python 模块 API 与监控服务的 HTTP API 两层。

## Python 入口

- `libertas.identity.user.UserManager`：注册、登录、会话、订阅。
- `libertas.identity.auth_manager.AuthManager`：验证码、许可证、子账号。
- `libertas.observability.notifications`：通知中心与邮件通道。
- `libertas.tools.tool_governance`：工具目录、权限与执行。

## HTTP 入口

监控服务默认监听 `127.0.0.1:8781`。常用路由：

- `GET /api/health`、`GET /api/model`
- `POST /api/loop/subscribe`、`GET /api/loop/confirm`
- `GET /api/loop/subscriptions`、`GET /api/loop/next`
- `POST /api/auth/login`、`POST /api/auth/register`
- `GET /api/visitor/bootstrap`、`GET /api/community/overview`

管理端需要 `mrhua_session` cookie。监控 API 默认不对公网开放；远程访问用 SSH 隧道。
