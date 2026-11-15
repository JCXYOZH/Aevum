# Libertas 内置插件

从 `mrhua/plugins` 迁入的成熟工具插件。每个插件一个文件，统一通过 `register(registry)` 注册；插件本身不依赖旧项目目录。

## 已迁入

| 插件 | 用途 |
| --- | --- |
| `cors_check.py` | CORS 配置检测：Origin 反射、凭证、预检请求 |
| `cve_lookup.py` | NVD CVE 查询：描述、CVSS、受影响产品、CWE |
| `email_validate.py` | 邮箱格式、MX、SMTP 可达性与一次性邮箱检测 |
| `encode_decode.py` | Base64/Base32/Base58/URL/Hex/HTML/ROT 等编解码 |
| `encoder_chain.py` | 多轮编码链与自动解码 |
| `hash_calc.py` | 文本/文件多算法哈希 |
| `http_headers_check.py` | HTTP 安全响应头检测与评分 |
| `ip_info.py` | IP 地理位置、ASN、组织、端口信息 |
| `json_tool.py` | JSON 格式化、校验、路径查询、差异与格式转换 |
| `log_analyzer.py` | Apache/Nginx 访问日志攻击特征与扫描器识别 |
| `password_gen.py` | 随机密码生成与强度评估 |
| `ping_test.py` | ICMP/TCP Ping、端口连通性、Traceroute |
| `regex_test.py` | 正则匹配、替换、分割与常用模式库 |
| `robots_check.py` | robots.txt / sitemap 解析与路径验证 |
| `ssl_cert_check.py` | 证书链、协议、密钥算法与有效期检查 |
| `time_convert.py` | 时间戳、日期、时区、时间差与 Cron 解析 |
| `url_parser.py` | URL 解析、重定向、短链接与钓鱼特征分析 |
| `whois_lookup.py` | WHOIS 注册信息、DNSSEC、域名年龄 |

同时迁入 `utils/text_decode.py`，统一处理外部命令输出的 UTF-8/GBK/BOM 解码，供 `email_validate`、`ping_test`、`whois_lookup` 使用。

## 使用

```python
from libertas.plugins import get_registry, call_tool

registry = get_registry()
print(registry.tool_names())

result = call_tool("hash_calc", text="abc", algo="sha256")
print(result)
```

注册表 API：

- `register_tool(name, func, params=None, category="通用", desc="")`
- `register_hook(hook_name, func)` / `call_hook(hook_name, *args, **kwargs)`
- `register_search_backend(name, func)`
- `register_menu(menu_id, label, callback_name, icon="")`
- `call_tool(name, **kwargs)`
- `list_tools()` / `tool_names()`

`get_registry()` 首次调用时加载本包内所有带 `register` 的模块，导入阶段不执行网络请求。

## 有意未迁入

- `plugins_expansion.py`：插件市场、沙箱、热加载等框架扩展，和现有基础设施重叠，且完成度不足。
- `qtwebengine_crash_research.py`：单次漏洞研究记录与 PoC 说明，不是可复用工具。
- `payload_generator.py`、`jwt_tool.py`、`subdomain_takeover.py`：攻击载荷、弱密钥爆破和接管探测，不作为基础插件迁入。
- `dir_scan.py`、`port_scan.py`、`subdomain_enum.py`、`http_methods.py`：扫描/探测类插件暂缓，等扫描执行器接口确定后再评估。

## 修复

- `time_convert.py` 在 Windows 上对 1970 附近时间调用 `datetime.timestamp()` 会抛 `OSError`，已增加 `_safe_timestamp()` 回退，并在时间戳模式直接传入已知时间戳。
- 清除 `MrHua` User-Agent、SMTP EHLO 域名等旧标识，统一为 `Libertas` / `libertas.local`。
- 删除空的 `example.py` 占位文件，避免和真实插件混在一起。

## 验证

```powershell
python -m compileall -q src\libertas\plugins src\libertas\utils
python -c "import sys; sys.path.insert(0,'src'); from libertas.plugins import get_registry; print(get_registry().tool_names())"
```

离线 smoke 已覆盖 `hash_calc`、`encode_decode`、`encoder_chain`、`json_tool`、`time_convert`、`regex_test`、`password_gen`、`log_analyzer`；网络类插件只验证注册和签名，未在测试中发起外部请求。

## 边界

- 网络插件依赖外部站点或系统命令（`whois`、`ping`、`traceroute`），不可用时会返回错误字典。
- 插件参数说明是注册表元数据，不做严格 JSON Schema 校验；调用方需按函数签名传参。
- 尚未接入上层工具路由；目前通过 `get_registry()` / `call_tool()` 直接使用。
