"""职责模块：external。"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from libertas.foundation.config import get

from .models import ToolDefinition, ToolParameter
from .registry import ToolRegistry

class ExternalToolLoader:
    """把配置中的 external_tools 注册为可执行工具。

    配置只提供工具路径、可选参数模板和元数据；仓库不内置扫描参数模板。
    使用者在本地 config 中填写 args 后即可通过统一执行链路调用。
    """

    def __init__(self, registry: ToolRegistry, config: Dict[str, Any] = None):
        self.registry = registry
        self.config = config if config is not None else get("external_tools", {})

    def load(self) -> int:
        if not isinstance(self.config, dict):
            return 0
        count = 0
        for name, meta in self.config.items():
            if not isinstance(meta, dict):
                continue
            if self._register(name, meta):
                count += 1
        return count

    def _register(self, name: str, meta: Dict[str, Any]) -> bool:
        path = str(meta.get("path") or name).strip()
        if not path or self.registry.get(name):
            return False

        args = meta.get("args")
        if args is None:
            args = meta.get("args_template")
        if isinstance(args, list):
            args = " ".join(str(item) for item in args)
        args = str(args or "").strip()

        command_path = f'"{path}"' if " " in path and not path.startswith('"') else path
        command = f"{command_path} {args}".strip()

        parameters: List[ToolParameter] = []
        placeholders = []
        for placeholder in re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", args):
            if placeholder not in placeholders:
                placeholders.append(placeholder)
        for placeholder in placeholders:
            parameters.append(ToolParameter(
                name=placeholder,
                param_type="string",
                description=meta.get(f"{placeholder}_description", placeholder),
                required=True,
            ))

        tool = ToolDefinition(
            name=name,
            description=str(meta.get("description") or name),
            category=str(meta.get("category") or "utility"),
            risk_level=str(meta.get("risk_level") or "low_risk"),
            parameters=parameters,
            returns=str(meta.get("returns") or ""),
            tags=list(meta.get("tags") or ["external"]),
            timeout=float(meta.get("timeout", 0) or 0),
            max_retries=int(meta.get("max_retries", 0) or 0),
            requires_confirmation=bool(meta.get("requires_confirmation", False)),
            enabled=bool(meta.get("enabled", True)),
            command=command,
            output_parser=str(meta.get("parser") or "text"),
        )
        self.registry.register(tool)
        return True
