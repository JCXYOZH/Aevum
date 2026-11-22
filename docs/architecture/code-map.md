# 代码地图

按“谁读、谁写、谁只做调度”划分。新增代码先找对应模块，不要继续往入口文件里堆。

## 控制平面

| 文件 | 职责 | 不应包含 |
| --- | --- | --- |
| `control/contract.py` | 核心类型、规格、状态契约 | 具体核心实现 |
| `control/registry.py` | 登记 kernel / architecture / engine | 业务逻辑 |
| `control/supervisor.py` | 多进程启动、停止、轮询 | import libertas / fortuna / memoria |
| `control/relay/` | 纯内存中继 | 持久化业务状态 |

## 内核模块

| 目录 | 职责 |
| --- | --- |
| `src/kernel/fortuna/` | 引导、内存、调度、文件系统、网络、沙箱 |
| `src/kernel/host/bridge/` | 串口帧转 WebSocket |
| `src/kernel/host/console/robot/` | 引导、状态机、结构化错误、80×25 单元格 |

## AI 运行时模块

| 目录 | 职责 |
| --- | --- |
| `src/architecture/libertas/foundation` | 配置、终端、事件、缓存、限流、重试、指标、健康 |
| `src/architecture/libertas/identity` | 用户、会话、许可证、子账号、身份档案 |
| `src/architecture/libertas/identity/user/loop_storage.py` | 回路独立库、订阅、来源、墙、内部提醒 |
| `src/architecture/libertas/observability/notifications` | 通知中心、邮件/Webhook 通道、通知模型 |
| `src/architecture/libertas/tools` | 工具治理、插件、搜索、WAN 分享、旧工具适配 |
| `src/architecture/libertas/release` | 发布密钥、版本产物、安装器与发布索引 |
| `src/architecture/libertas/security` | 隐私、合规、规则、漏洞情报与旧安全模块 |
| `src/architecture/libertas/models/legacy_models` | 旧模型引擎迁入；体量大、边界独立，非当前主链路 |
| `src/architecture/memoria` | C++ 训练/生成内核 |

## 渲染引擎模块

| 目录 | 职责 |
| --- | --- |
| `engine/src/` | 数学、PMX/VMD、VRM、Live2D、WebGL2 |
| `engine/assets/` | 引擎侧素材与验证页 |
| `engine/*.md` | 引擎模块说明与架构 |

## 共享模块

| 目录 | 职责 |
| --- | --- |
| `src/shared/common` | 跨核心基础件 |
| `src/shared/integrations` | 外部系统适配 |

## 呈现模块

| 目录 | 职责 |
| --- | --- |
| `interface/web` | 展示页、3D 桌面、MrHua 页面 |
| `interface/desktop` | Electron 壳与安装包 |
| `interface/console` | 旧 QML / Web UI |

## 归档模块

`archive/backend-python/monitor/` 只读保留已放弃的 Python 业务后端。新代码不进入这里。

## 拆分规则

- 单文件目标不超过 500 行；超过 800 行必须说明原因。
- 一个文件只承担一个变化原因：路由、投影、持久化、生成、通知不要混在一起。
- 核心运行时层可以依赖共享层；共享层不能反向依赖三个核心运行时。
- 兼容入口只做 re-export，不复制实现。
- 新拆出的 mixin 必须带模块 docstring 和类 docstring，公开方法保留原有签名。
- 大型旧模块（如 `generation_stream.py`）留作单独文件，先在审计报告中标记为高风险例外，不在没有回归测试的情况下强拆。
