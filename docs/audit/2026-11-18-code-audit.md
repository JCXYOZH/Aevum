# Aevum 全仓代码审计（2026-11-18）

## 结论

这一轮做了三件事：把入口层真正拆开、把文档占位补成可读内容、把审计口径写成可复算脚本。

| 指标 | 审计前 | 审计后 | 口径 |
| --- | --- | --- | --- |
| 代码利用率（模块） | 18.1% | 18.2% | 从 `apps/` Python 入口沿 `libertas` 导入图可达的模块 |
| 代码利用率（行数） | 18.5% | 18.5% | 可达模块的代码行 / `src/libertas` 总代码行 |
| 文档完善性（页面） | 18.6% | 100.0% | `docs/*.md` 中正文 ≥200 字符的文档比例 |
| 模块 docstring | 85.7% | 85.7% | `src/libertas` 有模块 docstring 的文件比例 |
| 符号 docstring | 53.2% | 53.2% | 函数/类中有 docstring 的比例 |
| 文档综合分 | 52.5% | 79.6% | 页面/模块/符号三项等权 |
| 拆分规范性 | 99.3% 文件 ≤500 行 | 99.6% 文件 ≤500 行 | `src/libertas` + `apps/console/monitor` + `apps/relay` |
| 超 500 行文件 | 7 个 | 4 个 | 同上 |
| 最大文件 | 2793 行 | 2793 行 | `legacy_models/model_engine/generation_stream.py` |

**代码利用率偏低不是“代码全是垃圾”，而是当前 Web 主链路只引用了 Libertas 的一部分能力。** 大量 `legacy_models`、`legacy_security`、`tools/legacy_tools`、发布与实验模块没有被 `apps/` 入口导入，属于可选能力或历史迁移层。是否删除要按功能价值判断，不能只看这个数字。

## 这轮拆了什么

### 1. 监控入口

`apps/console/monitor/desktop_server.py`：1172 行 → 194 行。

拆成：

- `monitor_config.py`：运行路径、静态目录、模型可执行文件、搜索工具定义。
- `monitor_payloads.py`：指标、检查点、模型、错误码、健康状态投影。
- `monitor_http.py`：`do_GET` / `do_POST` / `do_DELETE`、静态文件、鉴权与回路委派。
- `monitor_chat.py`：本地生成、云端生成、工具调用。
- `desktop_server.py`：只保留 CLI、Handler 组合和启动。

Handler 现在是 `MonitorHandler(MonitorHTTPMixin, MonitorChatMixin, BaseHTTPRequestHandler)`，公开路由不变。

### 2. 身份 HTTP 适配

`apps/console/monitor/auth_api.py`：905 行 → 437 行。

拆成：

- `auth_api.py`：会话、cookie、账号信息、GET/POST/DELETE 分发、FastAPI 工厂。
- `auth_loop.py`：`/api/loop/*` 的订阅、确认、退订、来源、墙、导出。
- `auth_account.py`：`/api/auth/*` 的注册、登录、验证码、许可证、找回、子账号。

### 3. 用户持久化

`src/libertas/identity/user/storage.py`：1038 行 → 264 行。

拆成：

- `storage.py`：用户表、加载/保存、守护规则。
- `loop_storage.py`：回路独立库、订阅、来源、墙、审计和站长内部提醒。

`UserStorageMixin` 继承 `LoopStorageMixin`，`UserManager` 的公开方法保持不变。

### 4. 真实 bug

`src/libertas/observability/notifications/models.py` 的 `Notification` 使用 `datetime`，但文件没有导入。真实订阅链路在构造通知对象时直接抛：

```text
name 'datetime' is not defined
```

已在 `42b1735` 补 `from datetime import datetime`。这不是临时脚本问题；不补这一行，订阅提醒在进入 `EmailChannel` 之前就会失败。

## 拆分规范性判断

当前 4 个超 500 行文件：

| 文件 | 行数 | 判断 |
| --- | ---: | --- |
| `src/libertas/models/legacy_models/model_engine/generation_stream.py` | 2793 | **高风险例外**：单个生成循环方法体过大，拆分需要逐段建立行为基线；本轮不动 |
| `src/libertas/models/legacy_models/model_engine/cloud_stream.py` | 848 | 旧模型引擎，独立于当前 Web 主链路；可后续按“请求 / 流式解析 / 错误映射”拆 |
| `src/libertas/identity/user/loop_storage.py` | 795 | 本轮已从 1038 行拆出；可继续把邮件配置/提醒拆成 `loop_mail.py` |
| `src/libertas/models/legacy_models/model_engine/memory_retrieval.py` | 688 | 旧模型引擎，独立；需要行为测试后再拆 |

**拆分规范性结论：文件尺寸合规率 99.6%，但“大文件集中度”仍然偏高。** 3 个旧模型文件是历史迁移边界，不应为了数字强行拆；`loop_storage.py` 还有明确的下一步拆分空间。

## 文档完善性判断

- 45/45 个 `docs/*.md` 已有实质正文，空占位清零。
- 页面口径 100.0%，但模块 docstring 只有 85.7%、符号 docstring 只有 53.2%；三项等权综合为 **79.6%**。
- 新增 `architecture/overview.md`、`architecture/code-map.md`、`docs/audit/2026-11-18-code-audit.md`。
- 35 个原有空占位已补：架构、API、部署、运维、安全、发布、教程、FAQ、ADR。
- 不足：符号 docstring 仍只有 53.2%，大量旧模块只有模块级说明，没有逐函数说明。文档“页面完整度”是 100%，“代码内符号注释完整度”不是 100%。

## 验证

已执行：

```powershell
python -m py_compile src/libertas/identity/user/storage.py
python -m py_compile src/libertas/identity/user/loop_storage.py
python -m py_compile apps/console/monitor/monitor_config.py
python -m py_compile apps/console/monitor/monitor_payloads.py
python -m py_compile apps/console/monitor/monitor_http.py
python -m py_compile apps/console/monitor/monitor_chat.py
python -m py_compile apps/console/monitor/desktop_server.py
python -m py_compile apps/console/monitor/auth_api.py
python -m py_compile apps/console/monitor/auth_loop.py
python -m py_compile apps/console/monitor/auth_account.py
python apps/console/monitor/desktop_server.py --help
```

结果：

- `UserManager()` 可实例化，`_init_db` / `_load` / `_save` / `loop_subscribe` 均在继承链上。
- `AuthAPI` 脚本模式与包模式均可导入，`register` / `login` / `loop_subscribe` 方法可解析。
- 拆分后的监控服务在 `8782` 启动成功，`GET /` 返回 `200`，页面含 `data-page="showcase"`。
- `python tools/analyze.py` 输出与上表一致。

## 没有做的事

- 没有安装 `pytest` / `coverage`，因此**没有运行时覆盖率**；代码利用率是静态可达率，不是测试覆盖率。
- 没有拆 `generation_stream.py` 的单方法体，因为没有对应回归测试，强拆风险高于收益。
- 没有改 `EmailChannel` 的静默失败行为；此前用户要求不要改代码，且该提交已 revert。
- 没有操作服务器；服务器需同步代码后重跑部署验收。

## 下一步建议

1. 把 `loop_storage.py` 的 `mail.json` 读取和内部提醒拆成 `loop_mail.py`，目标 ≤500 行。
2. 给 `legacy_models` 建最小行为基线，再决定是否拆 `cloud_stream.py` / `memory_retrieval.py`。
3. 把 `requirements-dev.txt` 补上 pytest / coverage，先跑真实测试，再谈运行时覆盖率。
4. CI 增加 `python tools/analyze.py` 和 `compileall`，把三项指标变成回归门槛。
5. 对当前主链路的模块补符号 docstring，优先 `apps/console/monitor` 和 `identity/user`。

## 复算

```powershell
D:\venv\Scripts\python.exe tools\analyze.py
D:\venv\Scripts\python.exe tools\analyze.py --json
```
