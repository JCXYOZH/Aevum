# 架构总览

Aevum 由三个核心运行时、一个控制平面和若干独立层组成。界面、运维、实验各自独立，不再把 Python 业务后端当成主链路。

```text
control/                  控制平面：核心登记、状态、多进程管理
  ├─ kernel               管理 src/kernel
  ├─ architecture         管理 src/architecture
  └─ engine               管理 engine

src/kernel/
  ├─ fortuna/             内核（Kernel）
  └─ host/                串口桥、引导盘、机器人例程

src/architecture/
  ├─ libertas/            AI 运行时：身份、工具、通知、治理、安全
  └─ memoria/             AI 运行时：训练、生成、检查点

engine/                   渲染引擎（Render Engine）：数学、PMX/VMD、VRM、Live2D、WebGL2
```

## 运行边界

| 层 | 入口 | 是否落盘 | 说明 |
| --- | --- | --- | --- |
| 呈现层 | `interface/web/index.html` | 否 | 根路径 `/` 返回展示页；`desktop.html` 是 3D 桌面 |
| 控制平面 | `control/supervisor.py` | 否 | 只启动、停止、轮询，不导入核心实现 |
| 中继 | `control/relay` | 否 | 会话与分片只在内存，重启即清空 |
| 内核 | `src/kernel/fortuna` + `src/kernel/host` | 取决于构建产物 | 只输出状态、错误码与单元格 |
| AI 运行时 | `src/architecture/libertas` + `memoria` | 取决于运行数据 | 身份、工具、训练、生成 |
| 渲染引擎 | `engine/` | 否 | 纯渲染与数学，不承载业务 |

## 分层

1. **控制平面**：`control/`。只认 `CoreSpec` 和 `CoreStatus`，不 import 任何核心。
2. **核心运行时**：`src/kernel`、`src/architecture`、`engine`。三个核心运行时各自有 README 和目录边界。
3. **共享层**：`src/shared`。只放跨核心基础件，不放业务。
4. **呈现层**：`interface/web`、`interface/desktop`、`interface/console`。不直接碰串口和数据库。
5. **运维层**：`ops/`。部署、构建、脚本、工具。
6. **归档层**：`archive/backend-python`。已放弃的 Python 业务后端，只读保留，不参与新主线。

## 关键原则

- 页面只呈现，不推断后端状态。
- 目录按职责分层：底层模块放在更深的目录；同一层一个文件只承担一个职责。
- `control/` 是控制平面，不是第四个核心；它不写业务状态。
- 新代码只进三个核心运行时、共享层、呈现层、运维层或实验层；不再回填 `archive/backend-python`。
- 旧安全模块保留兼容入口，但新代码按 `foundation / identity / observability / security` 分层引用。

## 相关文档

- [目录总图](../../STRUCTURE.md)
- [代码地图](code-map.md)
- [Libertas 架构](libertas.md)
- [内核模块](../../src/kernel/README.md)
- [AI 运行时](../../src/architecture/README.md)
- [控制平面](../../control/README.md)
- [归档说明](../../archive/backend-python/README.md)
