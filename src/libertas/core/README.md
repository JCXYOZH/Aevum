# Libertas 核心基础设施

从 `mrhua/core` 迁入的成熟基础设施子集。每个文件一个职责，保留可单测的通用能力；依赖概念模拟或旧业务状态的模块不迁。

## 模块

| 文件 | 职责 |
| --- | --- |
| `exceptions.py` | 统一异常体系、错误码、上下文、异常包装 |
| `terminal.py` | 线程安全终端输出：分级、表格、进度、Spinner、Banner |
| `event_bus.py` | 同步/异步事件总线、订阅、历史与通配符 |
| `cache.py` | LRU、TTL、命名空间缓存与装饰器 |
| `ratelimit.py` | 令牌桶、滑动窗口、固定窗口、配额限流 |
| `retry.py` | 重试策略、执行器、熔断器、超时控制 |
| `metrics.py` | Counter、Gauge、Histogram、Timer、注册表与系统指标 |
| `health.py` | 健康检查注册、汇总、超时与状态 |
| `timing.py` | 计时记录、统计、装饰器、管线计时与回归检测 |

`core` 目录中原有的空占位模块（如 `context.py`、`dispatcher.py`、`scanner.py`）未纳入本次迁移，也没有被当作可用实现。

## 清理

- `MrHuaError` 统一改为 `LibertasError`，`retry.py` 同步更新。
- `ConnectionError_`、`TimeoutError_` 改为 `NetworkConnectionError`、`NetworkTimeoutError`，去掉尾随下划线的兼容命名。
- `terminal.py` 的 `BANNER_MRHUA` 和 MRHUA 大字横幅改为 `BANNER_LIBERTAS`，内容改为专业 ASCII 标识。
- 删除 `timing.py` 末尾的 `TimingStage` “向后兼容占位类”。
- 修复 `TimingManager.timer()` 返回的 `Timer` 总是写入全局管理器的问题；现在显式绑定所属管理器。
- 终端成功/失败标记改为 `[ OK ]` / `[FAIL]`，Spinner 改为 ASCII `| / - \`，输出不含表情符号。
- 终端表格、分隔线保留 `─` 等专业图形标记，不使用 emoji。

## 使用

```python
from libertas.core import LibertasError, EventBus, LRUCache, RateLimiter
from libertas.core import RetryExecutor, RetryPolicy, MetricsRegistry, HealthChecker

bus = EventBus()
bus.subscribe("demo", lambda event: print(event.data))
bus.publish("demo", {"value": 1})

cache = LRUCache(max_size=100, ttl=60)
cache.set("key", "value")
print(cache.get("key"))
```

## 验证

```powershell
python -m compileall -q src\libertas\core
python -c "import sys; sys.path.insert(0,'src'); import libertas.core as c; print(len(c.__all__))"
```

离线 smoke 已覆盖：

- `LibertasError` 错误码与 `to_dict`
- `EventBus` 订阅、同步投递、历史
- `LRUCache` 写入、读取、容量淘汰
- `RateLimiter` 令牌桶允许/拒绝
- `RetryExecutor` 首次失败后重试成功
- `CircuitBreaker` 失败熔断与复位
- `Counter`、`Gauge`、`Histogram`、`MetricsRegistry`
- `HealthChecker` 注册与 `overall_status`
- `TimingManager` 上下文计时与统计
- `Terminal` 实际输出，确认 `[ OK ]` / `[FAIL]` / `[WARN]`，无 emoji
