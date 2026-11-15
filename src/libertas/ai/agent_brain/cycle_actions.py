"""
core/agent_brain.py - Agent自主循环大脑

核心能力：七阶段自主循环（感知→思考→规划→决策→执行→观察→反思→学习）、
状态机驱动、任务动态规划、多策略决策、上下文智能裁剪、反思学习闭环、
目标层级管理、注意力聚焦、自我监控、可中断可恢复。
整合记忆库、工具库、代码库三大本地化能力。
"""
import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task



class CycleActionsMixin:
    """循环执行动作：工具调用、参数生成、结果解析与最终结果。"""

    def _phase_execute(self, record: CycleRecord, decision: Dict[str, Any],
                       context: Dict) -> Dict[str, Any]:
        """执行阶段：调用工具/搜索/分析代码（真实执行逻辑，支持100+安全工具和网络搜索）"""
        start = time.time()
        self.state_machine.transition(AgentPhase.EXECUTE)
        action = decision.get("action", "")
        current_task = self.planner.get_next_task()
        task_desc = current_task.description if current_task else ""
        requirement = context.get("requirement", task_desc)
    
        result = {"action": action, "success": True, "output": ""}
    
        if current_task:
            self.planner.start_task(current_task.task_id)
    
        try:
            # 根据行动类型调用对应的模块
            if action == "web_search" or action == "search":
                # 调用网络搜索功能
                try:
                    from ..tools.search_orchestrator import SearchOrchestrator
                    searcher = SearchOrchestrator()
                    search_result = searcher.search(requirement, max_results=8, fast_only=True)
                    results_list = search_result.get("results", [])
                    result["output"] = f"网络搜索完成，找到 {len(results_list)} 条结果"
                    result["search_results"] = results_list[:5]
                    if results_list:
                        result["output"] += f": {results_list[0].get('title', '')[:80]}"
                except Exception as e:
                    result["output"] = f"网络搜索失败: {str(e)[:100]}，尝试使用工具库搜索"
                    # 回退到工具库中的搜索工具
                    if self.tools:
                        try:
                            if hasattr(self.tools, "execute"):
                                tool_result = self.tools.execute("web_search", {"query": requirement, "max_results": 5})
                                result["output"] = f"搜索工具执行完成: {str(tool_result)[:150]}"
                                result["tool_result"] = str(tool_result)[:500]
                        except Exception as e2:
                            result["output"] = f"搜索工具也失败: {str(e2)[:80]}"
                            result["success"] = False
    
            elif action == "search_memory":
                # 调用记忆系统检索相关记忆
                if self.memory:
                    try:
                        query = task_desc or context.get("requirement", "")
                        if hasattr(self.memory, "search"):
                            mem_results = self.memory.search(query, top_k=5)
                            result["output"] = f"记忆检索完成，找到 {len(mem_results) if isinstance(mem_results, list) else 0} 条相关记忆"
                            result["memory_results"] = mem_results if isinstance(mem_results, list) else []
                        elif hasattr(self.memory, "retrieve"):
                            mem_results = self.memory.retrieve(query, limit=5)
                            result["output"] = f"记忆检索完成，找到 {len(mem_results) if isinstance(mem_results, list) else 0} 条相关记忆"
                            result["memory_results"] = mem_results if isinstance(mem_results, list) else []
                        else:
                            result["output"] = "记忆系统已连接，但未找到搜索方法"
                    except Exception as e:
                        result["output"] = f"记忆检索失败: {str(e)[:100]}"
                        result["success"] = False
                else:
                    result["output"] = "记忆系统未连接，跳过记忆检索"
    
            elif action == "execute_tool":
                # 调用工具库执行工具（支持100+安全工具，智能提取参数）
                if self.tools:
                    try:
                        # 从任务描述中提取工具名
                        tool_name = self._extract_tool_name(task_desc) or self._extract_tool_name(requirement)
                        if tool_name:
                            # 智能生成工具参数
                            params = self._generate_tool_params(tool_name, requirement, task_desc)
                            terminal.info(f"执行工具 {tool_name}，参数: {list(params.keys())}", "autonomous_cycle")
                            if hasattr(self.tools, "execute"):
                                tool_result = self.tools.execute(tool_name, params)
                                # 解析工具结果
                                result_output = self._parse_tool_result(tool_result)
                                result["output"] = f"工具 {tool_name} 执行完成: {result_output[:200]}"
                                result["tool_result"] = result_output[:500]
                                result["tool_name"] = tool_name
                                result["success"] = getattr(tool_result, "status", "success") == "success"
                            else:
                                result["output"] = f"工具库方法不支持"
                        else:
                            # 没有识别到具体工具，列出可用工具
                            if hasattr(self.tools, "list_tools"):
                                available = self.tools.list_tools()
                                result["output"] = f"未识别到具体工具，工具库中有 {len(available)} 个可用工具"
                                result["available_tools"] = [t.name for t in available[:10]] if available else []
                            else:
                                result["output"] = f"工具库已连接，任务: {task_desc[:100]}"
                    except Exception as e:
                        result["output"] = f"工具执行失败: {str(e)[:100]}"
                        result["success"] = False
                        terminal.error(f"工具执行异常: {e}", "autonomous_cycle")
                else:
                    result["output"] = "工具库未连接，跳过工具执行"
    
            elif action == "search_code" or action == "write_code":
                # 调用代码库搜索或分析代码
                if self.codebase:
                    try:
                        query = task_desc or context.get("requirement", "")
                        if action == "search_code" and hasattr(self.codebase, "search"):
                            code_results = self.codebase.search(query, limit=5)
                            result["output"] = f"代码搜索完成，找到 {len(code_results) if isinstance(code_results, list) else 0} 个匹配"
                            result["code_results"] = code_results if isinstance(code_results, list) else []
                        elif action == "write_code" and hasattr(self.codebase, "analyze"):
                            analysis = self.codebase.analyze(query)
                            result["output"] = f"代码分析完成: {str(analysis)[:200]}"
                            result["code_analysis"] = analysis
                        else:
                            result["output"] = f"代码库已连接，任务: {task_desc[:100]}"
                    except Exception as e:
                        result["output"] = f"代码操作失败: {str(e)[:100]}"
                        result["success"] = False
                else:
                    result["output"] = "代码库未连接，跳过代码操作"
    
            elif action == "run_test":
                result["output"] = "测试运行任务已分配"
            elif action == "complete":
                result["output"] = "任务完成"
            else:
                result["output"] = f"执行行动: {action}，任务: {task_desc[:100]}"
    
        except Exception as e:
            result["success"] = False
            result["output"] = f"执行阶段异常: {str(e)[:150]}"
            terminal.error(f"执行阶段异常: {e}", "autonomous_cycle")
    
        record.action = action + ": " + result["output"][:200]
        record.add_phase("execute", (time.time() - start) * 1000,
                        f"执行 {action}")
        return result

    def _extract_tool_name(self, task_desc: str) -> str:
        """从任务描述中提取工具名（使用工具库动态搜索，支持381个工具）"""
        if not task_desc or not self.tools:
            return ""
    
        try:
            if hasattr(self.tools, "search_tools"):
                results = self.tools.search_tools(task_desc, limit=3)
                if results:
                    first = results[0]
                    tool_name = first.name if hasattr(first, 'name') else first.get('name', '')
                    if tool_name:
                        terminal.info(f"工具库搜索匹配: {tool_name}", "autonomous_cycle")
                        return tool_name
        except Exception as e:
            terminal.debug(f"工具库搜索失败: {e}", "autonomous_cycle")
        return ""

    def _generate_tool_params(self, tool_name: str, requirement: str, task_desc: str) -> Dict:
        """根据工具名和任务描述智能生成参数"""
        params = {}
        text = f"{requirement} {task_desc}".lower()
    
        # 提取目标（IP/域名/URL）
        import re
        ip_match = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
        domain_match = re.search(r'\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b', text)
        url_match = re.search(r'https?://\S+', text)
    
        target = ""
        if url_match:
            target = url_match.group(0)
        elif domain_match:
            target = domain_match.group(0)
        elif ip_match:
            target = ip_match.group(0)
    
        # 根据工具类型生成参数
        if tool_name in ["nmap", "masscan", "port_scan"]:
            if target:
                params["target"] = target
            params["ports"] = "1-1000" if "全端口" in text or "all" in text else "top100"
            params["scan_type"] = "syn" if "syn" in text else "connect"
            params["service_detection"] = True
            params["os_detection"] = "操作系统" in text or "os" in text
    
        elif tool_name in ["whois", "dns_lookup", "dig", "nslookup"]:
            if target:
                params["domain"] = target
            params["query_type"] = "A" if "mx" in text else "MX" if "mx" in text else "A"
    
        elif tool_name in ["subfinder", "sublist3r", "amass", "assetfinder", "subdomain_enum"]:
            if target:
                params["domain"] = target
            params["max_results"] = 50
            params["active"] = False
    
        elif tool_name in ["dirb", "dirsearch", "gobuster", "ffuf"]:
            if target:
                params["url"] = target if target.startswith("http") else f"http://{target}"
            params["wordlist"] = "common"
            params["extensions"] = "php,asp,aspx,jsp,html,txt"
            params["threads"] = 10
    
        elif tool_name in ["nikto", "nuclei", "arachni", "web_vuln_scan", "vuln_scan"]:
            if target:
                params["url"] = target if target.startswith("http") else f"http://{target}"
            params["scan_level"] = "medium"
            params["timeout"] = 30
    
        elif tool_name in ["sqlmap"]:
            if target:
                params["url"] = target if target.startswith("http") else f"http://{target}"
            params["level"] = 2
            params["risk"] = 1
            params["batch"] = True
    
        elif tool_name in ["hydra", "medusa", "ncrack"]:
            if target:
                params["target"] = target
            params["service"] = "ssh" if "ssh" in text else "ftp" if "ftp" in text else "http"
            params["username_list"] = "common"
            params["password_list"] = "common"
    
        elif tool_name in ["ping", "traceroute"]:
            if target:
                params["target"] = target
            params["count"] = 4
    
        elif tool_name in ["curl", "http_headers", "web_fetch"]:
            if target:
                params["url"] = target if target.startswith("http") else f"http://{target}"
            params["method"] = "GET"
            params["follow_redirects"] = True
    
        elif tool_name in ["ssl_info", "sslscan", "testssl", "openssl"]:
            if target:
                params["host"] = target
            params["port"] = 443
    
        elif tool_name in ["web_search", "search"]:
            params["query"] = requirement
            params["max_results"] = 8
    
        else:
            # 默认参数
            if target:
                params["target"] = target
            params["timeout"] = 30
            params["verbose"] = False
    
        return params

    def _parse_tool_result(self, tool_result) -> str:
        """解析工具执行结果为可读文本"""
        if tool_result is None:
            return "无结果"
        if isinstance(tool_result, str):
            return tool_result[:500]
        if hasattr(tool_result, "raw_output") and tool_result.raw_output:
            return str(tool_result.raw_output)[:500]
        if hasattr(tool_result, "output") and tool_result.output:
            return str(tool_result.output)[:500]
        if hasattr(tool_result, "data") and tool_result.data:
            return str(tool_result.data)[:500]
        if isinstance(tool_result, dict):
            if "output" in tool_result:
                return str(tool_result["output"])[:500]
            if "result" in tool_result:
                return str(tool_result["result"])[:500]
            return str(tool_result)[:500]
        return str(tool_result)[:500]

    def _get_final_result(self, requirement: str) -> Dict[str, Any]:
        """获取最终结果"""
        state = self.state_machine.get_state()
        completed = [t for t in self.planner.tasks.values() if t.status == TaskStatus.COMPLETED]
        failed = [t for t in self.planner.tasks.values() if t.status == TaskStatus.FAILED]
        return {
            "requirement": requirement,
            "cycles_executed": state.cycle_count,
            "total_tasks": len(self.planner.tasks),
            "completed_tasks": len(completed),
            "failed_tasks": len(failed),
            "success_rate": round(len(completed) / max(len(self.planner.tasks), 1), 4),
            "total_actions": state.total_actions,
            "success_actions": state.success_count,
            "errors": state.error_count,
            "final_phase": state.current_phase.value,
            "lessons_learned": len(self.reflection_learner.lessons),
            "cycle_records": [r.to_dict() for r in list(self.cycle_records)[-5:]],
            "completed_task_results": [
                {"task": t.description, "result": t.result[:300]}
                for t in completed[-5:]
            ],
        }
