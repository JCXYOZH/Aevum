# Memoria 监控 API

由 `apps/console/monitor/desktop_server.py` 提供，默认 `http://127.0.0.1:8781`。页面只调这些接口，不直接读权重或训练文件。

## 只读

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/api/health` | 监控、中继、串口桥、QEMU 的当前状态 |
| GET | `/api/trainer` | 最近训练指标、检查点、设备与参数量 |
| GET | `/api/errors` | 中继契约里的错误码表 |
| GET | `/api/apps` | 看板启动项 |
| GET | `/api/model` | 本地检查点、默认参数、语料路径、当前模型 exe |

## 生成

`POST /api/model/generate`

```json
{
  "prompt": "What ",
  "max_new_tokens": 48,
  "temperature": 1.0,
  "device": "cpu",
  "checkpoint": "build/checkpoint_demo"
}
```

返回 JSON，包含 `ok`、`output`、`checkpoint`、`device`、`elapsed_ms`，失败时带 `error`。监控把 stdout 的 `generated:` 前缀之后的内容作为 `output`；它不伪造生成结果。

## 路径规则

- `MEMORIA_BUILD_ROOT`：检查点与模型 exe 的根；默认 `build`。
- `MEMORIA_DATA_ROOT`：语料根；默认 `data`。
- `MEMORIA_WEB_ROOT`：页面根；冻结包默认 `resources/web`，源码默认 `apps/community/web`。
- 所有路径必须落在 `ROOT`、`BUILD_ROOT` 或 `DATA_ROOT` 内；越界返回 `path must stay inside the project, model root or data root`。

## 云端预留

看板的「云端加载 / 预留位」只把地址存到浏览器 `localStorage`（键 `memoria.remoteModel`），当前不发送请求。云端接口接入后，仍应经监控中转，避免页面直接持有模型进程或令牌。
