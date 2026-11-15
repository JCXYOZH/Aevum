# Libertas 模块索引与迁移说明

`src/libertas` 是 Libertas 的全部源码根。`libertas.core` 只保留兼容入口，具体实现按职责分布在 foundation、observability、security、identity、release、data、workflow、ai、tools、models、media、code、network 等顶层包中。

## 顶层包

| 包 | 职责 |
| --- | --- |
| `core` | 旧 `libertas.core` 兼容入口，只做公共导出与转发 |
| `foundation` | 异常、终端、事件总线、缓存、限流、重试、指标、健康检查、计时、配置 |
| `observability` | 审计日志、运行监控、系统监控、通知、告警、报告生成 |
| `application` | 应用生命周期、启动、设置、会话与系统装配 |
| `identity` | 用户、认证、账号、身份、平台身份、委托 |
| `security` | 隐私、脱敏、合规、守护、沙箱、规则、漏洞情报、漏洞图谱 |
| `release` | 发布密钥、版本管理、版本发布 |
| `crypto` | 加密原语与密钥相关能力 |
| `data` | 数据目录、备份、迁移、知识库版本、快记、白板、日记、系统设置 |
| `storage` | 持久化存储适配 |
| `workflow` | 调度器、任务队列、工作流引擎、编排、任务规划 |
| `ai` | 智能体、记忆、认知、能力增强、模型控制、意图分类与路由、动态提示词、输出控制与校验、管线 |
| `models` | 模型解析、渲染对比、模型验证，以及 `legacy_mrhua` 迁移包 |
| `media` | 视频生成等媒体能力 |
| `vision` | 验证码预处理、OCR、感知哈希与统一视觉入口 |
| `tools` | 工具装配、治理、库、管理、匹配、统一工具中枢、插件系统、批量与二进制执行、帮助解析 |
| `plugins` | 插件包 |
| `contrib` | 外部贡献代码 |
| `utils` | 通用工具 |
| `network` | 节点管理、节点同步、云同步、SSH 隧道、API 网关，以及原有 ICMP/TCP/UDP 能力 |
| `p2p` | P2P 去中心化网络 |
| `protocols` | 协议实现与协议适配 |
| `interfaces` | 对外能力接口层 |
| `analyzers` | 分析器 |
| `detectors` | 检测器 |
| `exploits` | 漏洞利用能力 |
| `forensics` | 取证 |
| `honeypot` | 蜜罐 |
| `intelligence` | 情报 |
| `reporters` | 报告输出 |
| `responders` | 响应处置 |
| `reverse` | 逆向 |
| `rules` | 规则库 |
| `sandbox` | 沙箱运行 |
| `scanners` | 扫描器 |
| `siem` | SIEM 对接 |
| `signatures` | 签名库 |
| `deception` | 欺骗防御 |

## core 兼容入口

`src/libertas/core/__init__.py` 不再存放具体实现，只从 `foundation` 转发以下公共对象：

| 类别 | 导出 |
| --- | --- |
| 异常 | `LibertasError`、`ConfigError`、`AuthError`、`LicenseError`、`NetworkError`、`DataError`、`ToolError`、`SecurityError`、`RateLimitExceededError` |
| 终端 | `Color`、`LogLevel`、`Terminal`、`terminal`、`print_banner` |
| 事件 | `Event`、`EventBus`、`EventTypes`、`get_event_bus`、`publish`、`subscribe` |
| 缓存 | `LRUCache`、`TTLCache`、`CacheManager`、`get_cache_manager`、`cached`、`cache_get`、`cache_set` |
| 限流与重试 | `RateLimiter`、`TokenBucket`、`get_rate_limiter`、`rate_limit`、`RetryPolicy`、`RetryExecutor`、`CircuitBreaker`、`retry`、`with_timeout` |
| 指标 | `Counter`、`Gauge`、`Histogram`、`MetricsRegistry`、`get_registry`、`metrics_snapshot` |
| 健康检查 | `HealthStatus`、`HealthCheckResult`、`HealthChecker`、`get_health_checker`、`check_health`、`healthy_result`、`unhealthy_result` |
| 计时 | `TimingRecord`、`TimingManager`、`get_timing_manager`、`timeit`、`measure`、`timing_stats`、`PipelineTimer` |

示例：

```python
from libertas.core import LibertasError, EventBus, LRUCache, RateLimiter
from libertas.foundation.config import get_data_dir, config
from libertas.observability.audit_log import get_audit_logger
from libertas.identity.auth_manager import AuthManager
```

## models 迁移状态

`mrhua/models` 已迁入 `src/libertas/models/legacy_mrhua`，不覆盖原有 `model_parser`、`model_render_tools`、`model_validator`。

- 源目录真实 Python 文件 5 个，已全部迁入。
- macOS AppleDouble 垃圾文件 `._model_engine.py` 未迁入。
- 拆分后 `legacy_mrhua` 共 35 个 `.py`：
  - `model_engine/`：18 个模块
  - `model_engine_expansion/`：6 个模块
  - `prompt_engine/`：3 个模块
  - `prompt_engine_expansion/`：5 个模块
  - `schemas.py`：317 行，保持单文件
- 32 个文件不超过 500 行；3 个文件因单个方法体过大仍超过 500 行：
  - `model_engine/methods_10.py`：含 `generate_stream`
  - `model_engine/methods_6.py`：含 `_call_cloud_api_stream`
  - `model_engine/methods_12.py`：含 `_retrieve_related_memories`
- `ModelEngine` 的 107 个方法全部保留，组合为 `ModelEnginePart1..15 + ModelEngineBase`。
- 旧 `..core.*`、`..tools.*`、`..interfaces.web` 导入已改为 Aevum 路径：
  - `get_compliance_engine` 映射为 `get_compliance_system`
  - `DataManager` 映射为 `DataDirectoryManager`
  - Web UI 的 `get_MrHua`、`queue_orb_command` 由 `_compat_web.py` 提供兼容占位；接入 Aevum Web 层前这两个接口不是完整实现
- 模型侧已移除次数/频率默认限制：
  - 工具调用次数上限改为 `0`，表示不限制
  - 失败重试次数默认改为 `0`，表示不限制
  - `ModelConfig` 的 `rate_limit_per_minute`、`max_concurrent`、`max_retries` 默认值均为 `0`
  - `auto_approve=False` 仍保留在 AI 工具执行侧，属于对 AI 的审批约束，不施加于真人

## 验证

```powershell
python -m compileall -q src\libertas
```

当前结果：

```text
compile=0
```

models 子包验证：

```text
legacy_mrhua 6/6 导入通过
ModelEngine 107/107 方法存在
9/9 单例工厂返回实例
函数全局名检查 0 处未定义
```

## 清理记录

- 删除 10 个 0 字节占位文件：`context.py`、`correlation.py`、`dispatcher.py`、`engine.py`、`fuzzer.py`、`plugin_loader.py`、`rule_manager.py`、`scanner.py`、`signature_db.py`、`sniffer.py`。
- 删除 `config.py` 的 `_CompatConfig` 兼容类和旧数据目录迁移入口，`config` 直接指向 `Config` 单例。
- 删除 `timing.py` 的 `TimingStage` 兼容占位类。
- `ConnectionError_`、`TimeoutError_` 改为 `NetworkConnectionError`、`NetworkTimeoutError`。
- 旧品牌名统一替换为 `Libertas`、`LIBERTAS`、`LibertasData`、`libertas.db`。
- 终端 Spinner 改为 ASCII `| / - \`，成功/失败标记改为 `[ OK ]` / `[FAIL]`。
- 全量源码扫描并移除表情符号，运行输出改为 `[AI]`、`[LINK]`、`[SYNC]`、`[TOOL]`、`[INFO]` 等文本标记。
- `core/text_decode.py` 不重复迁移，继续使用 `libertas.utils.text_decode`。
- 删除 `src/libertas/MODULE_AUDIT.md`，模块状态统一维护在本文件。
- `mrhua/models` 拆分后不再保留 8426 行单体 `model_engine.py`。
