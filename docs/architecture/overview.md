# 架构总览

Aevum 由三个运行面和两套内核组成。Web 页面只负责呈现，后端只负责状态与动作，模型与安全能力按需加载。

```text
浏览器
  ├─ 展示页 / 3D 桌面 / 治理窗口
  │    apps/community/web
  ├─ 本地监控 API
  │    apps/console/monitor/desktop_server.py
  │      ├─ monitor_http.py      路由与静态资源
  │      ├─ monitor_payloads.py  指标/检查点/健康投影
  │      ├─ monitor_chat.py      本地与云端对话
  │      └─ api/*                FastAPI 路由
  ├─ 纯内存中继
  │    apps/relay
  ├─ 串口桥
  │    apps/console/bridge
  └─ Qt / Electron 壳
       apps/desktop
```

## 运行边界

| 面 | 入口 | 是否落盘 | 说明 |
| --- | --- | --- | --- |
| 展示面 | `apps/community/web/index.html` | 否 | 根路径 `/` 返回展示页；`/desktop` 才是 3D 桌面 |
| 监控面 | `apps/console/monitor/desktop_server.py` | 读检查点/指标，写运行日志 | 默认 `127.0.0.1:8781` |
| 中继面 | `apps/relay` | 否 | 会话、上下文、分片只在内存，重启即清空 |
| 内核面 | `apps/console/kernel` + `src/memoria` | 取决于构建产物 | 只输出状态、错误码和 80×25 单元格 |

## 分层

1. **呈现层**：`apps/community/web` 与 `apps/desktop`。不直接读数据库，不直接碰串口。
2. **适配层**：`apps/console/monitor`。把 HTTP 请求转成身份、回路、治理、对话和模型动作。
3. **领域层**：`src/libertas`。账号、订阅、通知、工具治理、发布、网络安全等。
4. **内核层**：`src/memoria` 与 `apps/console/kernel`。训练/生成与串口状态机。

## 关键原则

- 页面只呈现，不推断后端状态。
- 订阅只给站长发内部提醒，不自动联系订阅者。
- 中继不落盘，不建账号，不做检索。
- 本机模型生成默认只在本机开放；云端模式必须显式配置。
- 旧安全模块保留兼容入口，但新代码按 `foundation / identity / observability / security` 分层引用。

## 相关文档

- [代码地图](code-map.md)
- [Libertas 架构](libertas.md)
- [监控服务](../../apps/console/monitor/README.md)
- [中继说明](../../apps/relay/README.md)
