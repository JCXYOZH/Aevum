# Libertas 插件

每个插件现在是独立包，注册与实现分开：

```text
web/cors_check/
├── __init__.py   导出 register 和业务函数
├── plugin.py     只负责注册、参数说明和分类
└── logic.py      只负责业务实现
```

## 分类

| 目录 | 插件包 |
| --- | --- |
| `web/` | `cors_check`、`http_headers_check`、`robots_check`、`ssl_cert_check`、`url_parser` |
| `network/` | `email_validate`、`ip_info`、`ping_test`、`whois_lookup` |
| `encoding/` | `encode_decode`、`encoder_chain`、`hash_calc`、`json_tool`、`regex_test`、`time_convert` |
| `analysis/` | `cve_lookup`、`log_analyzer` |
| `utility/` | `password_gen` |

`libertas.plugins` 递归扫描这五个目录，导入每个包并调用 `register(registry)`。

## 插件扩展

`plugins_expansion.py` 只保留公开导出。实现拆到 `expansion/`：

| 文件 | 职责 |
| --- | --- |
| `state.py` | `PluginState` |
| `plugin_type.py` | `PluginType` |
| `manifest.py` | `PluginManifest` |
| `instance.py` | `PluginInstance` |
| `dependency.py` | 依赖解析 |
| `sandbox.py` | 沙箱执行 |
| `hot_loader.py` | 热加载 |
| `event_bus.py` | 通信总线 |
| `lifecycle.py` | 生命周期管理 |
| `__init__.py` | 导出与单例入口 |

## 注册表

```python
from libertas.plugins import get_registry, call_tool

registry = get_registry()
print(registry.tool_names())

result = call_tool("hash_calc", text="abc", algo="sha256")
print(result)
```

`PluginRegistry` 提供：

- `register_tool` / `call_tool` / `list_tools` / `tool_names`
- `register_hook` / `call_hook`
- `register_search_backend` / `search`
- `register_menu` / `list_menus`

## 清理

- 删除 8 个攻击、爆破、扫描、接管与 PoC 文件：`payload_generator.py`、`jwt_tool.py`、`subdomain_takeover.py`、`qtwebengine_crash_research.py`、`dir_scan.py`、`port_scan.py`、`subdomain_enum.py`、`http_methods.py`。
- 删除插件文档头中的 `插件/作者/版本/分类` 元信息，统一为职责说明。
- 删除“增强版”字样和 `encode_decode` 的兼容别名逻辑。
- 旧 `MrHua` / `MRHUA` / `mrhua` 标识改为 `Libertas` / `LIBERTAS` / `libertas`。
- 邮箱验证结果改为 `[ OK ]`、`[WARN]`、`[FAIL]`。
- 旧 `..core` 导入改为 `libertas.foundation`。

## 验证

```text
compile=0
tools 18
errors []
emoji hits=0
encode_decode base64enc -> YWJj
```
