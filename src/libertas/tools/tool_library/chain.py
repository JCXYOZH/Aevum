"""职责模块：chain。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import re
import threading
import time
import uuid

from .executor import ToolExecutor
from .registry import ToolRegistry

class ToolChain:
    """工具链 - 多工具顺序/并行/条件/循环编排"""

    def __init__(self, name: str = "", description: str = ""):
        self.chain_id = f"chain_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.steps: List[Dict[str, Any]] = []
        self.variables: Dict[str, Any] = {}
        self.execution_history: List[Dict] = []
        self.created_at = time.time()

    def add_step(self, tool_name: str,
                 input_mapping: Optional[Dict[str, str]] = None,
                 output_var: str = "",
                 condition: str = "",
                 description: str = "",
                 timeout: float = 0.0) -> str:
        """添加步骤
        input_mapping: 将变量映射到工具参数，如 {"target": "$target", "port": "$scan.ports[0]"}
        output_var: 结果保存到变量名
        condition: 执行条件表达式，如 "$scan.status == 'success'"
        """
        step_id = f"step_{uuid.uuid4().hex[:6]}"
        step = {
            "step_id": step_id,
            "tool_name": tool_name,
            "input_mapping": input_mapping or {},
            "output_var": output_var,
            "condition": condition,
            "description": description,
            "timeout": timeout,
            "status": "pending",
            "result": None,
        }
        self.steps.append(step)
        return step_id

    def add_parallel_group(self, steps: List[Dict],
                           description: str = "") -> str:
        """添加并行执行组"""
        group_id = f"group_{uuid.uuid4().hex[:6]}"
        group = {
            "step_id": group_id,
            "type": "parallel",
            "steps": steps,
            "description": description,
            "status": "pending",
            "result": None,
        }
        self.steps.append(group)
        return group_id

    def add_loop(self, tool_name: str, iterator_var: str,
                 items_var: str, input_mapping: Optional[Dict] = None,
                 output_var: str = "", description: str = "") -> str:
        """添加循环步骤"""
        step_id = f"loop_{uuid.uuid4().hex[:6]}"
        step = {
            "step_id": step_id,
            "type": "loop",
            "tool_name": tool_name,
            "iterator_var": iterator_var,
            "items_var": items_var,
            "input_mapping": input_mapping or {},
            "output_var": output_var,
            "description": description,
            "status": "pending",
            "result": None,
        }
        self.steps.append(step)
        return step_id

    def execute(self, executor: ToolExecutor,
                initial_vars: Optional[Dict] = None) -> Dict[str, Any]:
        """执行工具链"""
        self.variables = dict(initial_vars or {})
        results = []
        start_time = time.time()

        for step in self.steps:
            step_result = self._execute_step(step, executor)
            results.append(step_result)
            if step_result.get("status") == "failed" and step.get("stop_on_failure", True):
                break

        execution = {
            "chain_id": self.chain_id,
            "name": self.name,
            "status": "success" if all(r.get("status") == "success" for r in results) else "failed",
            "steps": results,
            "variables": self.variables,
            "duration_ms": (time.time() - start_time) * 1000,
            "timestamp": time.time(),
        }
        self.execution_history.append(execution)
        return execution

    def _execute_step(self, step: Dict, executor: ToolExecutor) -> Dict:
        """执行单个步骤"""
        step["status"] = "running"

        # 检查条件
        if step.get("condition"):
            if not self._eval_condition(step["condition"]):
                step["status"] = "skipped"
                return {"step_id": step["step_id"], "status": "skipped",
                        "reason": "条件不满足"}

        # 并行组
        if step.get("type") == "parallel":
            return self._execute_parallel(step, executor)

        # 循环
        if step.get("type") == "loop":
            return self._execute_loop(step, executor)

        # 普通步骤
        tool_name = step["tool_name"]
        parameters = self._resolve_inputs(step.get("input_mapping", {}))

        result = executor.execute(tool_name, parameters, step.get("timeout", 0))
        step["result"] = result
        step["status"] = result.status

        # 保存输出变量
        if step.get("output_var"):
            self.variables[step["output_var"]] = result.data if result.data else result.raw_output

        return {
            "step_id": step["step_id"],
            "tool_name": tool_name,
            "status": result.status,
            "duration_ms": result.duration_ms,
            "error": result.error,
            "output_var": step.get("output_var", ""),
        }

    def _execute_parallel(self, group: Dict, executor: ToolExecutor) -> Dict:
        """执行并行组"""
        tasks = []
        for step in group["steps"]:
            tool_name = step["tool_name"]
            parameters = self._resolve_inputs(step.get("input_mapping", {}))
            tasks.append((tool_name, parameters))
        results = executor.execute_parallel(tasks)
        group["status"] = "success" if all(r.status == "success" for r in results) else "failed"
        group["result"] = results
        return {
            "step_id": group["step_id"],
            "type": "parallel",
            "status": group["status"],
            "results_count": len(results),
            "success_count": sum(1 for r in results if r.status == "success"),
        }

    def _execute_loop(self, step: Dict, executor: ToolExecutor) -> Dict:
        """执行循环"""
        items = self.variables.get(step["items_var"], [])
        if not isinstance(items, list):
            items = [items]
        results = []
        for item in items:
            self.variables[step["iterator_var"]] = item
            parameters = self._resolve_inputs(step.get("input_mapping", {}))
            result = executor.execute(step["tool_name"], parameters)
            results.append(result)
        step["status"] = "success" if all(r.status == "success" for r in results) else "failed"
        step["result"] = results
        if step.get("output_var"):
            self.variables[step["output_var"]] = [r.data for r in results]
        return {
            "step_id": step["step_id"],
            "type": "loop",
            "status": step["status"],
            "iterations": len(results),
            "success_count": sum(1 for r in results if r.status == "success"),
        }

    def _resolve_inputs(self, input_mapping: Dict[str, str]) -> Dict[str, Any]:
        """解析输入映射，支持 $var 语法"""
        resolved = {}
        for param_name, var_ref in input_mapping.items():
            if isinstance(var_ref, str) and var_ref.startswith("$"):
                resolved[param_name] = self._resolve_var(var_ref[1:])
            else:
                resolved[param_name] = var_ref
        return resolved

    def _resolve_var(self, var_path: str) -> Any:
        """解析变量路径，支持 a.b.c 和 a[0]"""
        parts = re.split(r'\.|\[|\]', var_path)
        parts = [p for p in parts if p]
        value = self.variables
        for part in parts:
            if isinstance(value, dict):
                value = value.get(part)
            elif isinstance(value, list) and part.isdigit():
                value = value[int(part)]
            else:
                break
        return value

    def _eval_condition(self, condition: str) -> bool:
        """简单条件求值"""
        try:
            # 替换 $var 为实际值
            eval_str = condition
            for var_name, var_value in self.variables.items():
                if isinstance(var_value, str):
                    eval_str = eval_str.replace(f"${var_name}", f"'{var_value}'")
                else:
                    eval_str = eval_str.replace(f"${var_name}", str(var_value))
            return bool(eval(eval_str, {"__builtins__": {}}, {}))
        except Exception:
            return True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chain_id": self.chain_id,
            "name": self.name,
            "description": self.description,
            "steps_count": len(self.steps),
            "execution_count": len(self.execution_history),
            "steps": [{"step_id": s["step_id"], "tool_name": s.get("tool_name", ""),
                       "description": s.get("description", "")} for s in self.steps],
        }

class ToolChainPlanner:
    """工具链规划器 - 根据任务自动规划工具调用序列"""

    def __init__(self, registry: ToolRegistry):
        self.planner_id = f"plan_{uuid.uuid4().hex[:8]}"
        self.registry = registry
        self.plans: Dict[str, ToolChain] = {}
        self._lock = threading.RLock()

    def plan(self, task: str, context: Optional[Dict] = None) -> ToolChain:
        """根据任务规划工具链"""
        context = context or {}
        chain = ToolChain(name=f"计划: {task[:50]}", description=task)

        # 分析任务关键词
        task_lower = task.lower()

        # 规则1: 端口扫描任务
        if any(kw in task_lower for kw in ["端口扫描", "port scan", "扫描端口", "开放端口"]):
            target = context.get("target", "127.0.0.1")
            chain.add_step("nmap_scan",
                          input_mapping={"target": target, "scan_type": "syn", "ports": "1-1000"},
                          output_var="scan_result",
                          description="SYN扫描常用端口")
            chain.add_step("parse_nmap_result",
                          input_mapping={"raw_output": "$scan_result"},
                          output_var="parsed_ports",
                          description="解析扫描结果")

        # 规则2: 漏洞扫描任务
        elif any(kw in task_lower for kw in ["漏洞扫描", "vuln scan", "漏洞检测", "vulnerability"]):
            target = context.get("target", "127.0.0.1")
            chain.add_step("nmap_scan",
                          input_mapping={"target": target, "scan_type": "vuln", "ports": "1-1000"},
                          output_var="vuln_scan",
                          description="漏洞脚本扫描")
            chain.add_step("whois_lookup",
                          input_mapping={"domain": target},
                          output_var="whois_info",
                          description="获取域名信息")

        # 规则3: 信息收集任务
        elif any(kw in task_lower for kw in ["信息收集", "recon", "侦察", "信息搜集"]):
            target = context.get("target", "example.com")
            chain.add_step("whois_lookup",
                          input_mapping={"domain": target},
                          output_var="whois",
                          description="WHOIS查询")
            chain.add_step("dns_lookup",
                          input_mapping={"domain": target, "record_type": "A"},
                          output_var="dns_a",
                          description="DNS A记录查询")
            chain.add_step("dns_lookup",
                          input_mapping={"domain": target, "record_type": "MX"},
                          output_var="dns_mx",
                          description="DNS MX记录查询")
            chain.add_step("http_headers",
                          input_mapping={"url": f"https://{target}"},
                          output_var="headers",
                          description="获取HTTP头")

        # 规则4: 密码破解任务
        elif any(kw in task_lower for kw in ["密码破解", "brute force", "暴力破解", "hydra"]):
            target = context.get("target", "127.0.0.1")
            service = context.get("service", "ssh")
            chain.add_step("hydra_brute",
                          input_mapping={"target": target, "service": service,
                                         "username": context.get("username", "admin"),
                                         "wordlist": context.get("wordlist", "/usr/share/wordlists/rockyou.txt")},
                          output_var="brute_result",
                          description="Hydra暴力破解")

        # 规则5: Web扫描任务
        elif any(kw in task_lower for kw in ["web扫描", "目录扫描", "dirb", "nikto", "web扫描"]):
            url = context.get("url", "http://example.com")
            chain.add_step("nikto_scan",
                          input_mapping={"url": url},
                          output_var="nikto_result",
                          description="Nikto Web漏洞扫描")
            chain.add_step("dirb_scan",
                          input_mapping={"url": url, "wordlist": context.get("wordlist", "")},
                          output_var="dirb_result",
                          description="目录扫描")

        # 规则6: 默认 - 搜索最相关工具
        else:
            relevant_tools = self.registry.search(task, limit=3)
            for tool in relevant_tools:
                params = {}
                for p in tool.parameters:
                    if p.required:
                        params[p.name] = context.get(p.name, "")
                chain.add_step(tool.name,
                              input_mapping=params,
                              output_var=f"result_{tool.name}",
                              description=tool.description)

        with self._lock:
            self.plans[chain.chain_id] = chain
        return chain

    def get_plan(self, chain_id: str) -> Optional[ToolChain]:
        return self.plans.get(chain_id)

    def list_plans(self) -> List[ToolChain]:
        return list(self.plans.values())

    def get_stats(self) -> Dict[str, Any]:
        return {
            "planner_id": self.planner_id,
            "total_plans": len(self.plans),
            "available_tools": len(self.registry.tools),
        }
