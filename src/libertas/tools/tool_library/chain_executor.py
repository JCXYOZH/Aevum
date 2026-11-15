"""职责模块：chain_executor。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import time
import uuid

from .library import ToolLibrary

class ToolChainExecutor:
    """工具链执行器 - 自动解析依赖、按序执行、聚合结果、错误恢复"""

    def __init__(self, tool_library: "ToolLibrary", dependency_resolver=None):
        self.tools = tool_library
        self.dep_resolver = dependency_resolver
        self.chain_history: List[Dict[str, Any]] = []

    def execute_chain(self, tool_names: List[str], parameters: Dict[str, Dict] = None,
                       stop_on_error: bool = False,
                       on_tool_complete: Callable = None) -> Dict[str, Any]:
        """执行工具链

        Args:
            tool_names: 要执行的工具名列表
            parameters: 每个工具的参数字典 {tool_name: {param: value}}
            stop_on_error: 遇到错误是否停止
            on_tool_complete: 每个工具完成后的回调

        Returns:
            工具链执行结果汇总
        """
        parameters = parameters or {}
        # 1. 解析执行顺序
        if self.dep_resolver:
            try:
                ordered = self.dep_resolver.resolve_execution_order(tool_names)
            except Exception:
                ordered = tool_names
        else:
            ordered = tool_names

        # 2. 验证工具链
        validation = None
        if self.dep_resolver:
            try:
                validation = self.dep_resolver.validate_chain(ordered)
            except Exception:
                pass

        # 3. 执行工具链
        results = {}
        chain_start = time.time()
        success_count = 0
        failed_count = 0
        for idx, tool_name in enumerate(ordered):
            tool_start = time.time()
            try:
                params = parameters.get(tool_name, {})
                # 从前序工具结果中提取参数
                if idx > 0:
                    params = self._inject_previous_results(tool_name, params, results)
                result = self.tools.execute(tool_name, params)
                results[tool_name] = {
                    "status": result.status,
                    "raw_output": result.raw_output[:2000] if result.raw_output else "",
                    "data": result.data,
                    "error": result.error,
                    "duration_ms": result.duration_ms,
                    "return_code": result.return_code,
                }
                if result.status == "success":
                    success_count += 1
                else:
                    failed_count += 1
                    if stop_on_error:
                        break
                if on_tool_complete:
                    try:
                        on_tool_complete(tool_name, result, idx, len(ordered))
                    except Exception:
                        pass
            except Exception as e:
                results[tool_name] = {
                    "status": "failed",
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "duration_ms": (time.time() - tool_start) * 1000,
                }
                failed_count += 1
                if stop_on_error:
                    break

        # 4. 聚合结果
        total_duration = (time.time() - chain_start) * 1000
        chain_result = {
            "chain_id": f"chain_{uuid.uuid4().hex[:8]}",
            "tools_executed": list(results.keys()),
            "total_tools": len(ordered),
            "success_count": success_count,
            "failed_count": failed_count,
            "success_rate": success_count / len(ordered) if ordered else 0,
            "total_duration_ms": total_duration,
            "results": results,
            "validation": validation,
        }
        self.chain_history.append(chain_result)
        return chain_result

    def _inject_previous_results(self, tool_name: str, params: Dict,
                                  results: Dict) -> Dict:
        """从前序工具结果中提取参数注入当前工具"""
        # 简单规则：如果前序工具有target/url/domain字段，注入到当前工具
        for prev_name, prev_result in results.items():
            if prev_result.get("status") != "success":
                continue
            data = prev_result.get("data") or {}
            if isinstance(data, dict):
                for key in ("target", "url", "domain", "host", "ip"):
                    if key in data and key not in params:
                        params[key] = data[key]
        return params

    def execute_recon_chain(self, target: str) -> Dict[str, Any]:
        """执行标准信息收集工具链（实战常用）"""
        tools = ["ping_host", "whois_lookup", "dns_lookup", "http_headers", "nmap_scan"]
        params = {
            "ping_host": {"target": target},
            "whois_lookup": {"domain": target},
            "dns_lookup": {"domain": target},
            "http_headers": {"url": f"http://{target}"},
            "nmap_scan": {"target": target, "ports": "1-1000", "scan_type": "syn"},
        }
        return self.execute_chain(tools, params, stop_on_error=False)

    def execute_web_audit_chain(self, url: str) -> Dict[str, Any]:
        """执行标准Web安全审计工具链"""
        tools = ["http_headers", "nikto_scan", "dirb_scan", "nmap_scan"]
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.hostname or url
        params = {
            "http_headers": {"url": url},
            "nikto_scan": {"url": host},
            "dirb_scan": {"url": url},
            "nmap_scan": {"target": host, "ports": "80,443,8080,8443"},
        }
        return self.execute_chain(tools, params, stop_on_error=False)

    def get_chain_history(self, limit: int = 10) -> List[Dict]:
        """获取工具链执行历史"""
        return self.chain_history[-limit:]

    def get_chain_stats(self) -> Dict[str, Any]:
        """获取工具链统计"""
        if not self.chain_history:
            return {"total_chains": 0}
        total = len(self.chain_history)
        avg_success = sum(c["success_rate"] for c in self.chain_history) / total
        avg_duration = sum(c["total_duration_ms"] for c in self.chain_history) / total
        return {
            "total_chains": total,
            "average_success_rate": avg_success,
            "average_duration_ms": avg_duration,
            "most_used_tools": self._get_most_used_tools(),
        }

    def _get_most_used_tools(self) -> List[Dict]:
        """获取最常用的工具"""
        counter = {}
        for chain in self.chain_history:
            for tool in chain.get("tools_executed", []):
                counter[tool] = counter.get(tool, 0) + 1
        return sorted([{"tool": k, "count": v} for k, v in counter.items()],
                      key=lambda x: -x["count"])[:10]
