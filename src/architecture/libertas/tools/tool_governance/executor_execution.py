"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .error_text import _derive_error_text, _humanize_exception
from .models import PendingApproval, RiskLevel, ToolCallRecord


class ExecutorExecutionMixin:
    """工具执行、通知、回退与结果摘要。"""

    def execute(self, tool_name: str, tool_type: str = "native",
                params: Dict = None, session_id: str = "",
                auto_approve: bool = False,
                progress_cb: Callable = None,
                user_id: str = "",
                caller_type: str = "ai",
                _fallback_seen: Optional[set] = None,
                _root_error: str = "") -> Dict:
        """执行工具（带治理）
    
        参数：
            tool_name: 工具名
            tool_type: native / external / web
            params: 工具参数
            session_id: 会话ID
            auto_approve: True=自动批准（系统内部调用），False=走审批流程
            progress_cb: 进度回调
            user_id: 调用者ID（非空时检查权限委托）
            caller_type: ai=模型调用，受风险等级与审批约束；human=人工操作，不受风险上限与审批限制
        返回：
            {"success": bool, "data": ..., "error": ..., "governance": {...}}
        """
        params = params or {}
        target = (params.get("target") or params.get("url") or
                  params.get("domain") or params.get("host") or "")
    
        # 展示名可能带 ext_/wsl_ 前缀（用来区分与原生工具同名的外部/平台二进制），
        # 执行前还原成真实工具名，否则会去找 native_ext_xxx 然后报"工具不存在"。
        if tool_name.startswith(("ext_", "wsl_")) and tool_name.split("_", 1)[1]:
            tool_name = tool_name.split("_", 1)[1]
    
        # plugin_ 前缀的工具：权限检查和记录时使用去掉前缀的真实插件名
        actual_name = tool_name
        if tool_type == "plugin" and tool_name.startswith("plugin_"):
            actual_name = tool_name[7:]
    
        # 回退防环：handle_error 的 "alternate" 策略会回头再调 execute，
        # 若替代工具同样失败并再次取替代，就会 execute -> handle_error -> execute
        # 无限递归（最终 RecursionError）。这里沿调用链记录已试过的工具，
        # 重复经过即中止，保证回退链是有限的。
        if _fallback_seen is None:
            _fallback_seen = set()
        if actual_name in _fallback_seen:
            # 用链条最上游的真实错误，避免把「回退兜了一圈」这种表象当成原因回给调用方
            return {"success": False,
                    "error": _root_error or f"回退链重复经过工具 {actual_name}，已中止以避免死循环",
                    "governance": {"fallback_loop": True,
                                   "fallback_tried": sorted(_fallback_seen),
                                   "risk": "unknown"}}
        _fallback_seen.add(actual_name)
    
        # 0. 权限委托检查（非主人用户需要有效委托）
        # 人工操作只受用户配置的黑白名单、启用开关与审计约束，不叠加委托授权。
        if user_id and caller_type != "human":
            try:
                from libertas.identity.delegation import DelegationManager
                dm = DelegationManager()
                if not dm.check_permission(user_id, "tool_execute",
                                           tool_name=actual_name, target=target,
                                           level="execute"):
                    return {"success": False,
                            "error": f"用户 {user_id} 没有执行 {actual_name} 的权限委托",
                            "governance": {"blocked": True, "reason": "delegation_required"}}
            except Exception:
                pass
    
        # 1. 权限检查
        perm = self.gov.check_permission(actual_name, tool_type, params,
                                         caller_type=caller_type)
        if not perm["allowed"]:
            self.gov.record_call(actual_name, tool_type, params, target,
                               False, 0, error=perm["reason"],
                               session_id=session_id)
            return {"success": False, "error": perm["reason"],
                    "governance": {"blocked": True, "risk": perm["risk_level"]}}
    
        # 2. 审批：仅 AI 调用需要，人工操作直接执行
        user_approved = True
        if caller_type != "human" and perm["needs_approval"] and not auto_approve:
            approval = self.gov.request_approval(
                actual_name, tool_type, params, target,
                description=f"{perm['tool_info']['desc']} → {target}"
            )
            if progress_cb:
                progress_cb("approval_needed", approval_id=approval.id,
                           tool=actual_name, risk=perm["risk_level"],
                           description=approval.description)
            # 审批等待默认只等几秒（approval_wait_seconds），超时就把「待确认」
            # 直接回给模型，让它先去干别的或提示用户，而不是把这一轮卡满 5 分钟。
            try:
                _wait_s = float(self.gov._config.get("approval_wait_seconds", 8) or 0)
            except (TypeError, ValueError):
                _wait_s = 8.0
            approved = self.gov.wait_for_approval(approval.id, timeout=max(0.0, _wait_s))
            if not approved:
                self.gov.record_call(actual_name, tool_type, params, target,
                                   False, 0, error="等待用户确认超时",
                                   session_id=session_id)
                return {"success": False,
                        "error": (f"工具 {actual_name} 高于当前自动授权级别"
                                  f"（{perm['risk_level']}），需要用户在界面确认。"
                                  "已先跳过：可以先继续其它步骤，或让用户确认后再重试"),
                        "governance": {"pending_approval": approval.id,
                                       "needs_approval": True,
                                       "risk": perm["risk_level"]}}
            user_approved = True
    
        # 3. 执行（带重试和回退）
        start = time.time()
        last_error = ""
        retries = self.gov._config["max_retries"]
    
        for attempt in range(retries + 1):
            try:
                if progress_cb:
                    progress_cb("tool_start", tool=actual_name, attempt=attempt + 1)
    
                result = self._do_execute(actual_name, tool_type, params)
                duration = time.time() - start
    
                if result.get("success"):
                    summary = self._summarize_result(actual_name, result)
                    self.gov.record_call(
                        actual_name, tool_type, params, target,
                        True, duration, result_summary=summary,
                        user_approved=user_approved, session_id=session_id
                    )
                    # 喂入漏洞知识图谱
                    if self.scanner and getattr(self.scanner, 'vuln_graph', None):
                        try:
                            self.scanner.vuln_graph.ingest_result(
                                actual_name, target, result, params)
                        except Exception:
                            pass
                    if progress_cb:
                        progress_cb("tool_done", tool=actual_name,
                                   duration=duration, success=True)
                    if not _root_error:
                        self._notify_outcome(actual_name, target, True)
                    return {"success": True, "data": result.get("data", result),
                            "governance": {"risk": perm["risk_level"],
                                          "duration": duration,
                                          "attempts": attempt + 1}}
                else:
                    last_error = _derive_error_text(result, actual_name)
            except Exception as e:
                last_error = _humanize_exception(e, actual_name)
    
            # 错误处理
            if attempt < retries:
                fallback = self.gov.handle_error(
                    actual_name, tool_type, last_error, params,
                    alternate_tools=self._get_alternate_external_tools(actual_name)
                )
                if progress_cb:
                    progress_cb("tool_error", tool=actual_name,
                               error=last_error, strategy=fallback["strategy"],
                               attempt=attempt + 1)
    
                if fallback["strategy"] == "retry":
                    time.sleep(fallback["retry_after"])
                    continue
                elif fallback["strategy"] == "alternate" and fallback["alternate_tool"]:
                    alt_tool = fallback["alternate_tool"]
                    alt_type = detect_tool_type(alt_tool, self.scanner)
                    if progress_cb:
                        progress_cb("tool_fallback", from_tool=actual_name,
                                   to_tool=alt_tool)
                    alt_result = self.execute(
                        alt_tool, alt_type, params, session_id,
                        auto_approve=auto_approve, progress_cb=progress_cb,
                        user_id=user_id, _fallback_seen=_fallback_seen,
                        _root_error=_root_error or last_error
                    )
                    alt_result["governance"]["fallback_from"] = actual_name
                    alt_result["governance"]["fallback_reason"] = last_error
                    if not _root_error:
                        _alt_ok = bool(alt_result.get("success"))
                        self._notify_outcome(
                            alt_tool, target, _alt_ok,
                            "" if _alt_ok else str(alt_result.get("error", "")))
                    return alt_result
                elif fallback["strategy"] == "skip":
                    break
                else:
                    break
    
        duration = time.time() - start
        self.gov.record_call(actual_name, tool_type, params, target,
                           False, duration, error=last_error,
                           user_approved=user_approved, session_id=session_id)
        if not _root_error:
            self._notify_outcome(actual_name, target, False, last_error)
        return {"success": False, "error": last_error,
                "governance": {"risk": perm["risk_level"], "duration": duration,
                              "attempts": retries + 1}}

    def _notify_outcome(self, tool_name: str, target: str, success: bool,
                        error: str = "") -> None:
        """最外层执行结束后统一发一条通知。
    
        降级链（curl → 内置 http_headers 等）中间的失败不再逐条通知，
        否则用户会先看到「工具失败: curl」、随后又拿到成功结果，非常误导。
        """
        try:
            if self.scanner is None or not hasattr(self.scanner, "_notify_tool"):
                return
            self.scanner._notify_tool(
                tool_name, target or "",
                {"error": error, "elapsed": 0, "summary": ""}, success)
        except Exception:
            pass

    def _do_execute(self, tool_name: str, tool_type: str, params: Dict) -> Dict:
        """实际执行工具"""
        # 插件优先：用户插件可覆盖同名原生工具
        if tool_type == "plugin":
            # 插件工具：strip plugin_ 前缀后调用
            plugin_name = tool_name[7:] if tool_name.startswith("plugin_") else tool_name
            try:
                from libertas.tools.plugin_system import get_plugin_manager
                pm = get_plugin_manager()
                if plugin_name in pm.registry.tools:
                    # 插件函数用的是自己的参数名（email/text/url/value/pattern…），并不是统一的
                    # target。调用方按工具契约传的是 target，直接透传会 TypeError。这里像原生工具
                    # 那样，把 target 映射到插件函数的第一个参数，并过滤掉它不接受的键。
                    _pfunc = pm.registry.tools[plugin_name]
                    _call_params = dict(params)
                    try:
                        import inspect as _insp
                        _psig = _insp.signature(_pfunc)
                    except (TypeError, ValueError):
                        _psig = None
                    if _psig is not None:
                        _pnames = [p.name for p in _psig.parameters.values()
                                   if p.kind in (p.POSITIONAL_ONLY,
                                                 p.POSITIONAL_OR_KEYWORD,
                                                 p.KEYWORD_ONLY)]
                        if ("target" in _call_params and "target" not in _psig.parameters
                                and _pnames and _pnames[0] not in _call_params):
                            # 只在第一个参数没被显式给出时才用它承接 target；
                            # 否则会覆盖调用方更精确的参数（params 优先于 target）
                            _call_params[_pnames[0]] = _call_params.pop("target")
                        if not any(p.kind == p.VAR_KEYWORD
                                   for p in _psig.parameters.values()):
                            _call_params = {k: v for k, v in _call_params.items()
                                            if k in _psig.parameters}
                    result = pm.call_tool(plugin_name, **_call_params)
                    if isinstance(result, dict):
                        return result
                    return {"success": True, "data": result}
                return {"success": False, "error": f"插件 {plugin_name} 不存在"}
            except Exception as e:
                return {"success": False, "error": f"插件 {plugin_name} 执行失败: {e}"}
    
        if tool_type == "native":
            native = self._get_native_functions()
            func_name = f"native_{tool_name}"
            func = getattr(native, func_name, None)
            if func is None:
                return {"success": False, "error": f"原生工具 {tool_name} 不存在"}
            # 统一走 run_native_tool：由它负责展开嵌套 params、按真实签名把
            # target/host/url/ip 等通用名映射到该工具的主目标形参、缺必填参数时
            # 给可执行提示，并把原始异常文本归类成人话。
            # 原先这里按位置 func(target, **kwargs) 绑定：对 dns_lookup 这类
            # 「首个形参不是 target 但有 **_extra」的签名，target 会被 **_extra
            # 吸收而 domain 仍然缺失，与 scanner/batch 两条链行为不一致。
            return native.run_native_tool(tool_name, **params)
    
        elif tool_type == "external":
            if self.scanner is None:
                return {"success": False, "error": "扫描器未初始化"}
            # notify=False：降级链上每次尝试都会进来，这里发通知会让用户在
            # 「已经自动换成内置工具并成功」之后仍看到「工具失败: curl」。
            # 最终结果通知由 execute() 在收尾处统一发一次。
            result = self.scanner.run_tool(tool_name, params, notify=False)
            return result
    
        elif tool_type == "web":
            # Web工具由model_engine直接处理，这里不执行
            return {"success": False, "error": "Web工具由模型引擎直接处理"}
    
        return {"success": False, "error": f"未知工具类型: {tool_type}"}

    def _get_alternate_external_tools(self, tool_name: str) -> List[str]:
        """获取同类外部工具列表。
    
        get_tool_info(..., "external") 的 category 恒为"外部工具"，早期实现据此筛选等于
        没筛，会退化成"取前 3 个外部工具"——于是 dig 失败时会拿 whois 的结果当成功返回。
        这里改用 WSL_SECURITY_TOOLS 里的真实分类，只接受同类工具。
        """
        def _cat(name: str) -> str:
            for cat, items in WSL_SECURITY_TOOLS.items():
                if name in items:
                    return cat
            return ""
    
        category = _cat(tool_name)
        if not category:
            return []
        return [n for n in EXTERNAL_TOOL_RISK
                if n != tool_name and _cat(n) == category][:3]

    def _summarize_result(self, tool_name: str, result: Dict) -> str:
        """生成结果摘要"""
        data = result.get("data", result)
        if isinstance(data, dict):
            if "open_ports" in data:
                ports = data["open_ports"]
                return f"发现{len(ports)}个开放端口"
            if "records" in data:
                return f"返回{len(data['records'])}条记录"
            if "subdomains" in data:
                return f"发现{len(data['subdomains'])}个子域名"
            if "paths" in data:
                return f"发现{len(data['paths'])}个路径"
            if "alive" in data:
                return f"存活: {data['alive']}"
            if "status_code" in data:
                return f"HTTP {data['status_code']}"
        return "执行完成"
