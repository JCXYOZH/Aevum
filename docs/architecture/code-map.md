# 代码地图

按“谁读、谁写、谁只做适配”划分。新增代码先找对应层，不要继续往入口文件里堆。

## 入口

| 文件 | 职责 | 不应包含 |
| --- | --- | --- |
| `apps/console/monitor/desktop_server.py` | 启动 HTTP 服务、组装 Handler、解析 CLI | 具体数据投影、对话生成、账号动作 |
| `apps/console/monitor/monitor_http.py` | 路由、静态文件、鉴权/回路/WAN 委派 | 指标计算、模型子进程 |
| `apps/console/monitor/monitor_payloads.py` | 指标、检查点、模型、错误码、健康投影 | 写数据库、发邮件 |
| `apps/console/monitor/monitor_chat.py` | 本地生成、云端生成、工具调用 | 账号会话、订阅表 |
| `apps/console/monitor/auth_api.py` | 身份请求分发、会话与备份装配 | 具体订阅动作、具体账号动作 |
| `apps/console/monitor/auth_loop.py` | `/api/loop/*` 动作 | 登录、注册、许可证 |
| `apps/console/monitor/auth_account.py` | `/api/auth/*` 动作 | 回路订阅表 |
| `apps/console/monitor/api/*.py` | FastAPI 路由与请求模型 | 大段业务实现 |

## 领域

| 目录 | 职责 |
| --- | --- |
| `src/libertas/foundation` | 配置、终端、事件、缓存、限流、重试、指标、健康 |
| `src/libertas/identity` | 用户、会话、许可证、子账号、身份档案 |
| `src/libertas/identity/user/loop_storage.py` | 回路独立库、订阅、来源、墙、内部提醒 |
| `src/libertas/observability/notifications` | 通知中心、邮件/Webhook 通道、通知模型 |
| `src/libertas/tools` | 工具治理、插件、搜索、WAN 分享、旧工具适配 |
| `src/libertas/release` | 发布密钥、版本产物、安装器与发布索引 |
| `src/libertas/security` | 隐私、合规、规则、漏洞情报与旧安全模块 |
| `src/libertas/models/legacy_models` | 旧模型引擎迁入；体量大、边界独立，非当前 Web 主链路 |
| `src/memoria` | C++ 训练/生成内核 |
| `apps/relay` | 纯内存中继 |
| `apps/console/kernel` | 串口内核与状态机 |

## 拆分规则

- 单文件目标不超过 500 行；超过 800 行必须说明原因。
- 一个文件只承担一个变化原因：路由、投影、持久化、生成、通知不要混在一起。
- 适配层可以依赖领域层；领域层不能反向依赖 `apps/`。
- 兼容入口只做 re-export，不复制实现。
- 新拆出的 mixin 必须带模块 docstring 和类 docstring，公开方法保留原有签名。

## 当前例外

`src/libertas/models/legacy_models/model_engine/generation_stream.py` 的单个生成循环方法超过 2000 行。它来自旧模型引擎，拆分需要逐段建立行为基线；本轮保留为独立文件，并在审计报告中标记为高风险例外，不在没有回归测试的情况下强拆。
