# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def _short_url_error(exc: BaseException) -> str:
    """把抓取异常压缩成一句人话（原始 requests/urllib 报错又长又难读）"""
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "连接超时（网络不通/被防火墙拦截，或需要代理）"
    if isinstance(exc, ssl.SSLError):
        return "TLS 握手失败（证书或协议不兼容）"
    if isinstance(exc, urllib.error.HTTPError):
        return f"HTTP {exc.code} {exc.reason or ''}".strip()
    if isinstance(exc, urllib.error.URLError):
        reason = exc.reason
        if isinstance(reason, socket.gaierror):
            return "域名解析失败（DNS 无法解析该主机）"
        if isinstance(reason, (socket.timeout, TimeoutError)):
            return "连接超时（网络不通/被防火墙拦截，或需要代理）"
        return f"连接失败（{reason}）"
    if isinstance(exc, ValueError):
        return f"URL 无效（{exc}）"
    return f"{type(exc).__name__}: {exc}"

def _bindable_params(sig) -> set:
    """签名里可接收关键字实参的形参名（排除 *args / **kwargs）。"""
    return {pname for pname, p in sig.parameters.items()
            if p.kind not in (inspect.Parameter.VAR_POSITIONAL,
                              inspect.Parameter.VAR_KEYWORD)}

def _accepts_extra(sig) -> bool:
    """签名里是否有 **kwargs 兜底形参。"""
    return any(p.kind == inspect.Parameter.VAR_KEYWORD
               for p in sig.parameters.values())

def _first_positional_param(sig) -> Optional[str]:
    """签名里第一个可以按位置传入的形参名（兼容桥的落点）。"""
    for pname, p in sig.parameters.items():
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY,
                      inspect.Parameter.POSITIONAL_OR_KEYWORD):
            return pname
    return None

def _display_target(kwargs: Dict[str, Any]) -> str:
    """取一个用于回显的目标值，不参与参数绑定。"""
    for key in _DISPLAY_TARGET_KEYS:
        value = kwargs.get(key)
        if isinstance(value, str) and value:
            return value
    nested = kwargs.get("params")
    if isinstance(nested, dict):
        return _display_target(nested)
    return ""

def _is_blank(value: Any) -> bool:
    """空目标（None / 空串 / 纯空白）视为「未提供」，不做别名绑定。"""
    return value is None or (isinstance(value, str) and not value.strip())

def normalize_native_args(fn, kwargs: Dict[str, Any]):
    """把模型侧 {target, params:{...}} 契约归一化成 fn 真实签名可接受的关键字。

    返回 (normalized, report)；normalized 可直接 ``**`` 展开调用 fn，
    report 带机器可读信息（missing / expected / ignored / aliased），
    便于上层与模型自动纠错。
    """
    sig = inspect.signature(fn)
    bindable = _bindable_params(sig)
    accepts_extra = _accepts_extra(sig)
    normalized: Dict[str, Any] = {}

    # 1) 展开嵌套 params：顶层显式传参优先，不被嵌套值覆盖
    nested = kwargs.get("params")
    expanded = isinstance(nested, dict)
    if expanded:
        for k, v in nested.items():
            if k not in kwargs:
                normalized[k] = v
    for k, v in kwargs.items():
        if k != "params":
            normalized[k] = v

    # 1.5) 空白目标值（None / 空串 / 纯空白）按「未提供」处理：既不参与别名映射，
    #      也不落到兼容桥，交给必填校验给出「缺少参数」——与 _is_blank() 口径统一。
    #      只对「通用目标名」这么做；若该名字本身就是工具的真实形参（如 ip_info 的
    #      target），仍原样透传给工具，由工具自己判定取值是否合法。
    for k in list(normalized.keys()):
        if (k not in bindable and _TARGET_ALIAS_FAMILY.get(k)
                and _is_blank(normalized[k])):
            normalized.pop(k, None)

    # 2) 别名映射：通用目标名 → 该工具真实存在的主目标形参
    aliased: Dict[str, str] = {}
    for src in list(normalized.keys()):
        if src in bindable:
            continue                      # 已经是真实形参名，不映射
        family = _TARGET_ALIAS_FAMILY.get(src)
        if not family:
            continue
        if _is_blank(normalized[src]):
            continue                      # 空值不绑定，交给必填校验给出「缺少参数」
        for cand in _FAMILY_PARAM_PRIORITY.get(family, ()):
            if cand in bindable and cand not in normalized:
                normalized[cand] = normalized[src]
                aliased[src] = cand
                break
    # 已被别名消化掉的源键不再保留，避免又落进 **kwargs 变成噪声
    for src in aliased:
        normalized.pop(src, None)

    required = [pname for pname, p in sig.parameters.items()
                if p.kind not in (inspect.Parameter.VAR_POSITIONAL,
                                  inspect.Parameter.VAR_KEYWORD)
                and p.default is inspect.Parameter.empty]

    # 3) 兼容桥：模型把「主输入」放在 target 上，而该工具首个形参不是目标语义
    #    （如 encode_decode / hash_calculator 的 text、jwt_decoder 的 token）。
    #    绑定层历史实现是 func(target, **kwargs)，按位置把 target 落到第一个形参；
    #    这里保留该行为以免功能回退。判据只有两条：泛 target 未被别名消费、首个形参
    #    不是目标语义。**不再**要求「恰好缺一个必填形参」——那个条件过窄，会让
    #    hash_calculator(text='')/uuid_generator(count=5) 这类首形参带默认值的工具把
    #    target 静默丢弃却仍报成功（结果错、状态还是成功）。落点仍只取签名里真实
    #    存在的形参，绝不新增签名外的键。
    generic_src = next((k for k in ("target", "targets")
                        if not _is_blank(normalized.get(k))), None)
    first_pos = _first_positional_param(sig)
    bridged = None
    if (generic_src and generic_src not in bindable and generic_src not in aliased
            and first_pos and first_pos not in normalized
            and _TARGET_ALIAS_FAMILY.get(first_pos) is None):
        normalized[first_pos] = normalized[generic_src]
        bridged = first_pos
        # 与别名映射同样处理：源键已被消费，不再作为「被忽略参数」上报
        normalized.pop(generic_src, None)
        aliased[generic_src] = bridged

    # 4) 丢掉既不是真实形参、也无法被 **kwargs 吸收的键（绝不新增未知键）
    ignored = sorted(k for k in normalized
                     if k not in bindable and not accepts_extra)
    for k in ignored:
        normalized.pop(k, None)

    expected: Dict[str, str] = {}
    for pname, p in sig.parameters.items():
        if p.kind in (inspect.Parameter.VAR_POSITIONAL,
                      inspect.Parameter.VAR_KEYWORD):
            continue
        expected[pname] = ("必填" if p.default is inspect.Parameter.empty
                           else f"可选，默认 {p.default!r}")

    report = {
        "missing": [r for r in required if r not in normalized],
        "expected": expected,
        "ignored": ignored,
        "aliased": aliased,
        "bridged": bridged,
        "expanded_params": expanded,
        "signature": str(sig),
    }
    return normalized, report

def _looks_like_raw_error(text: str) -> bool:
    """判断一段错误文本是不是「未加工的原始信息」。

    自定义的中文提示（如「PTR查询失败」）应当原样保留，只有原始信息才改写。
    判据：含典型异常关键字，或整段没有中文（本项目的人话文案都是中文）。
    """
    if not text:
        return False
    if any(m in text for m in ("Error", "Errno", "Traceback", "Exception",
                               "urlopen", "error:")):
        return True
    return not re.search(r"[\u4e00-\u9fff]", text)

def _looks_like_exception_repr(text: Any) -> bool:
    """判断文本是不是「未处理的异常原文」（类型名开头 + 冒号，或 Traceback）。"""
    return bool(_EXC_REPR_RE.match(str(text or "")))

def is_missing_binary_text(text: Any) -> bool:
    """判断错误文本是否表示「外部命令不存在 / 未安装」（本文件与工具治理共用）。"""
    low = str(text or "").lower()
    if not low:
        return False
    return any(hint in low for hint in _MISSING_BINARY_HINTS)

def _error_kind_and_text(raw: str, exc: Optional[BaseException] = None):
    """把原始异常 / 原始错误文本归类成一句可读文案（参照 crawl 的 _short_error）。

    返回 (friendly, kind, detail)：
      friendly 为 None 表示「原文已经是可读文案」，调用方应原样保留、不要改写。
    """
    text = (raw or "").strip()
    low = text.lower()

    # 参数绑定问题（本文件最主要的一类）
    if "required positional argument" in low and "missing" in low:
        return ("工具参数缺失：调用时未提供必填参数。"
                "请用 search_tools 查询该工具的参数名后补齐重试", "bad_params", text)
    if "unexpected keyword argument" in low:
        return ("工具参数名不被接受：请用 search_tools 查询该工具支持的参数名后重试",
                "bad_params", text)
    if isinstance(exc, TypeError):
        return "工具参数类型不匹配：请核对参数名与取值后重试", "bad_params", text
    if isinstance(exc, KeyError):
        return ("工具内部缺少必要的配置或数据项：请检查相关配置后重试",
                "bad_params", text)
    if isinstance(exc, ValueError):
        return "工具参数取值不合法：请核对取值格式后重试", "bad_params", text

    # 非异常对象：只在文本确实像原始信息时才做归类，避免改写已有的中文文案
    if exc is None and not _looks_like_raw_error(text):
        return None, "unknown", text

    # 网络类（超时先判，因为 socket.timeout 属 OSError）
    if isinstance(exc, (FuturesTimeout, TimeoutError, socket.timeout)):
        return "执行超时（目标无响应或网络过慢）", "timeout", text
    if "connection refused" in low or "errno 111" in low:
        return "连接被拒绝（目标端口未监听或服务未启动）", "connection", text
    # 对端在返回任何响应前断开：HTTP/2-only 站点、TLS 端口、WAF/LB 主动丢弃、
    # 端口不是 HTTP 服务时都会这样。原文（Remote end closed connection without
    # response）对用户和模型都没有可操作信息，必须给出「换协议/换端口/换工具」的建议。
    if ("remote end closed connection" in low or "remotedisconnected" in low
            or "connection reset by peer" in low or "connection aborted" in low
            or "server disconnected" in low or "badstatusline" in low
            or "remote disconnected" in low):
        return ("对端在返回响应前关闭了连接（常见原因：该地址只支持 HTTPS/HTTP2、"
                "被 WAF/负载均衡丢弃，或这个端口根本不是 HTTP）。"
                "建议：改用 https:// 重试，或换 http_fingerprint / native_ssl_info 探测",
                "connection", text)
    if isinstance(exc, socket.gaierror) or (
            "name or service not known" in low or "getaddrinfo" in low
            or "nodename nor servname" in low
            or "temporary failure in name resolution" in low
            or "no address associated" in low):
        return "域名解析失败（DNS 查不到该域名，或本机无可用 DNS）", "dns", text
    if "network is unreachable" in low or "errno 101" in low:
        return "网络不可达（目标地址不可路由；检查网络出口或代理）", "network", text
    if "timed out" in low or "timeout" in low:
        return "执行超时（目标无响应或网络过慢）", "timeout", text
    if "certificate" in low or "ssl" in low or "tls" in low:
        return "TLS/证书校验失败（目标证书无效或存在 TLS 拦截）", "tls", text
    if isinstance(exc, ConnectionError):
        return "连接失败（目标不可达）", "connection", text

    # URL/主机名本身不合法（urllib 的原始文案：<urlopen error no host given>、
    # unknown url type、Invalid IPv6 URL…）。这类文案对用户与模型都没有可操作价值。
    # 注意：必须放在「连接被拒 / DNS / 超时 / TLS」之后，否则会把
    # <urlopen error [Errno 111] Connection refused> 这类真正的网络错误误判成地址问题。
    if ("no host given" in low or "unknown url type" in low
            or "invalid ipv6 url" in low or "no schema supplied" in low
            or "invalid url" in low or "urlopen error" in low):
        return ("目标地址不合法或缺少主机名（请给出完整地址，如 http://example.com）",
                "bad_target", text)

    # 本机 / 系统类
    if isinstance(exc, FileNotFoundError) or is_missing_binary_text(text):
        return "依赖的外部命令不存在（该工具未安装）", "missing_binary", text
    if isinstance(exc, PermissionError) or "permission denied" in low \
            or "errno 13" in low or "access is denied" in low:
        return "权限不足（需要更高权限，或目标拒绝访问）", "permission", text
    if "json" in low and ("decode" in low or "expecting" in low):
        return "返回内容不是合法 JSON（目标响应格式不符）", "parse", text
    if isinstance(exc, KeyboardInterrupt) or "cancelled" in low or "canceled" in low:
        return "执行已取消", "cancelled", text
    return None, "unknown", text

def humanize_error_text(raw: Any, exc: Optional[BaseException] = None) -> str:
    """把原始错误文本归类成人话；无法归类时原样返回（不丢信息、不为空）。"""
    text = str(raw or "").strip()
    if not text:
        return ""
    friendly, _kind, _detail = _error_kind_and_text(text, exc)
    return friendly or text

def pick_diagnostic_line(text: Any, limit: int = 200) -> str:
    """从命令输出里挑一行最有诊断价值的文本。

    跳过空行与纯符号行（如整行只有 `;`/`#`/`-` 的注释标记或分隔线），
    优先返回含报错关键字的行；没有命中的关键字时返回首个有效行。
    """
    if not text:
        return ""
    lines: List[str] = []
    for raw in str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line:
            continue
        cleaned = line.lstrip(";#*-=<>|~ \t")
        if not cleaned:
            continue
        lines.append(cleaned)
    if not lines:
        return ""
    for line in lines:
        low = line.lower()
        if any(key in low for key in _EXIT_DIAG_KEYWORDS):
            return line[:limit]
    return lines[0][:limit]

def external_exit_error(returncode: Any, stderr: Any = "", stdout: Any = "",
                        limit: int = 200, tool_name: str = "") -> str:
    """外部命令非零退出时生成一条可读失败原因，保证非空。

    外部工具常把有用信息写在 stdout（如 dig 的 communications error），
    所以 stderr 挑不出有效行时回退到 stdout。
    """
    detail = pick_diagnostic_line(stderr, limit) or pick_diagnostic_line(stdout, limit)
    if detail:
        return f"外部命令退出码 {returncode}：{detail}"
    try:
        rc = int(returncode)
    except (TypeError, ValueError):
        rc = None
    if rc is not None and str(tool_name or "").lower().startswith("curl"):
        hint = _CURL_EXIT_HINTS.get(rc)
        if hint:
            return f"curl 退出码 {rc}：{hint}（建议：换 http/https 协议或换目标后重试）"
    return f"命令返回非零退出码 {returncode}（无错误输出）"

def derive_failure_reason(result: Any, tool_name: str = "") -> str:
    """从工具返回字典派生一条可读失败原因：保证非空，且绝不产出「未知错误」。

    取值顺序：error → message/reason/detail → stderr/raw_output/stdout 首个有效行
    → returncode → 兜底的人话说明。
    """
    label = tool_name or "工具"
    if not isinstance(result, dict):
        return f"{label} 执行失败：未返回结构化结果（实际类型 {type(result).__name__}）"
    for key in ("error", "message", "reason", "detail"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            return humanize_error_text(value)
    for key in ("stderr", "raw_output", "stdout", "output"):
        line = pick_diagnostic_line(result.get(key))
        if line:
            rc = result.get("returncode")
            if rc is not None:
                return f"{label} 退出码 {rc}：{line}"
            return f"{label} 执行失败：{line}"
    rc = result.get("returncode")
    if rc is not None:
        return f"{label} 执行失败且无错误输出（退出码 {rc}）"
    return f"{label} 执行失败，但未返回可诊断信息（缺少 error / stderr / 退出码）"

def _ensure_data_dict(result: Dict[str, Any]) -> Dict[str, Any]:
    """保证 result["data"] 是 dict，便于挂机器可读字段。"""
    data = result.get("data")
    if not isinstance(data, dict):
        data = {} if data in (None, "") else {"value": data}
        result["data"] = data
    return data

def polish_native_result(tool_name: str, result: Dict[str, Any]) -> Dict[str, Any]:
    """统一收尾原生工具的返回：失败一定有原因，且原因是可读文案。

    - 失败但 error 是原始异常文本 → 归类比写成人话，原文放进 data.error_detail 便于排障；
    - 失败却完全没给 error（工具内部捕获后忘了写原因）→ 补一句可操作的原因。
    失败本身不会被吞掉：success 仍为 False。
    """
    if not isinstance(result, dict) or result.get("success"):
        return result
    raw = str(result.get("error") or "")
    friendly, kind, detail = _error_kind_and_text(raw)
    if friendly is None:
        if raw and _looks_like_exception_repr(raw):
            # 工具自己回吐了未处理的异常原文（如 "RuntimeError: ..."）：
            # 主字段给人话，类型名与内部信息只进 data.error_detail。
            friendly = (f"{tool_name} 执行失败：发生未预期的内部错误，未能给出可诊断原因。"
                        "可稍后重试或改用其它工具")
            kind, detail = "internal", raw
        elif raw:
            return result                      # 已是可读文案，原样保留
        else:
            friendly = (f"{tool_name} 未返回结果（目标不可达、不存在，或该项没有记录）。"
                        "请核对目标与参数后重试；需要参数说明可调用 search_tools")
            kind, detail = "no_result", ""
    if isinstance(result.get("data"), dict):
        result["data"].setdefault("error_kind", kind)
        if detail:
            result["data"].setdefault("error_detail", detail)
    result["error"] = friendly
    return result
