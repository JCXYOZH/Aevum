"""职责模块：dependency。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union

class ToolDependencyResolver:
    """工具依赖关系解析器 - 管理工具之间的前置/后置依赖关系"""

    def __init__(self, registry: "ToolRegistry"):
        self.registry = registry
        self.dependencies: Dict[str, List[str]] = {}
        self.conflicts: Dict[str, List[str]] = {}
        self._build_default_dependencies()

    def _build_default_dependencies(self):
        """构建默认依赖关系图"""
        # 信息收集类工具通常作为前置
        self.dependencies["nmap_scan"] = ["ping_host"]
        self.dependencies["nikto_scan"] = ["http_headers", "dns_lookup"]
        self.dependencies["dirb_scan"] = ["http_headers"]
        self.dependencies["sqlmap_scan"] = ["http_headers", "curl_request"]
        self.dependencies["hydra_brute"] = ["nmap_scan"]
        self.dependencies["masscan_scan"] = ["ping_host"]
        # 冲突关系
        self.conflicts["nmap_scan"] = ["masscan_scan"]
        self.conflicts["dns_lookup"] = ["dig_query"]

    def add_dependency(self, tool_name: str, depends_on: str):
        """添加依赖关系"""
        if tool_name not in self.dependencies:
            self.dependencies[tool_name] = []
        if depends_on not in self.dependencies[tool_name]:
            self.dependencies[tool_name].append(depends_on)

    def add_conflict(self, tool_name: str, conflicts_with: str):
        """添加冲突关系"""
        if tool_name not in self.conflicts:
            self.conflicts[tool_name] = []
        if conflicts_with not in self.conflicts[tool_name]:
            self.conflicts[tool_name].append(conflicts_with)

    def get_prerequisites(self, tool_name: str) -> List[str]:
        """获取工具的前置依赖列表"""
        return self.dependencies.get(tool_name, [])

    def get_dependents(self, tool_name: str) -> List[str]:
        """获取依赖该工具的所有工具"""
        return [name for name, deps in self.dependencies.items() if tool_name in deps]

    def has_conflict(self, tool_a: str, tool_b: str) -> bool:
        """检查两个工具是否冲突"""
        return tool_b in self.conflicts.get(tool_a, []) or                tool_a in self.conflicts.get(tool_b, [])

    def resolve_execution_order(self, tool_names: List[str]) -> List[str]:
        """拓扑排序：解析工具执行顺序"""
        visited = set()
        order = []
        def visit(name):
            if name in visited:
                return
            visited.add(name)
            for dep in self.get_prerequisites(name):
                if dep in tool_names:
                    visit(dep)
            order.append(name)
        for name in tool_names:
            visit(name)
        return order

    def validate_chain(self, tool_names: List[str]) -> Dict[str, Any]:
        """验证工具链的可行性"""
        result = {"valid": True, "errors": [], "warnings": [], "order": []}
        # 检查冲突
        for i, a in enumerate(tool_names):
            for b in tool_names[i+1:]:
                if self.has_conflict(a, b):
                    result["warnings"].append(f"工具 {a} 和 {b} 可能冲突，建议分开执行")
        # 检查缺失依赖
        for name in tool_names:
            for dep in self.get_prerequisites(name):
                if dep not in tool_names and not self.registry.get(dep):
                    result["errors"].append(f"工具 {name} 依赖 {dep}，但 {dep} 未注册且不在执行列表中")
        if result["errors"]:
            result["valid"] = False
        result["order"] = self.resolve_execution_order(tool_names)
        return result
