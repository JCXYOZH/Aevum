"""
工具管理器

管理工具的生命周期：发现、注册、初始化、启用、调用、禁用、卸载。
支持依赖管理、配置、状态监控、分组、导入导出。
"""
import os
import json
import time
import uuid
import importlib
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.utils.text_decode import decode_output, describe_exception

from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus


class ToolCommandMixin:
    """命令占位符解析、目标别名与命令构建。"""

    def _declared_slots(self, tool_name: str) -> set:
        """该工具在参数模板里真正声明过的占位符名（{url} → "url"）。"""
        try:
            td = getattr(self.assembler, "tools", {}).get(tool_name)
            if td is not None and getattr(td, "slots", None):
                return set(td.slots.keys())
        except Exception:
            pass
        return set()

    def _normalize_target_alias(self, tool_name: str, params: Dict) -> Dict:
        """把通用目标名对齐到工具声明的形参名（target ↔ url ↔ host ↔ domain ↔ ip）。
    
        不补齐就会出现「[WARN] 缺少必填参数: url」：模型明明给了 target，
        模板要的却是 url，于是命令里少了 -u，工具必然失败，而模型也不知道
        该改哪个键名。
        """
        slots = self._declared_slots(tool_name)
        if not slots:
            return params
        given = [k for k in params
                 if k in self._GENERIC_TARGET_KEYS and str(params.get(k) or "").strip()]
        if not given:
            return params
        # 优先用 target（模型契约里的主字段），其次是已经传进来的目标名
        given.sort(key=lambda k: 0 if k == "target" else 1)
        value = params[given[0]]
        fixed = dict(params)
        for slot in slots:
            if slot in self._GENERIC_TARGET_KEYS and not str(fixed.get(slot) or "").strip():
                fixed[slot] = value
        return fixed

    def build_command(self, tool_name: str, strict: bool = False, **params) -> List[str]:
        """根据参数模板构建命令列表（恢复0.1.5版本：使用assembler自动补全默认值）
    
        strict=True 时，缺少必填参数会抛 MissingToolParams，而不是打一条告警
        然后拼出一个注定失败的残缺命令。
        """
        params = self._normalize_target_alias(tool_name, params)
        if tool_name not in self.tools:
            # 尝试动态注册极简工具
            if self.assembler and hasattr(self.assembler, 'register_minimal_tool'):
                try:
                    self.assembler.register_minimal_tool(tool_name)
                except Exception:
                    pass
            self.tools[tool_name] = {"path": tool_name, "args": [], "category": "自定义"}
    
        # 提取额外参数（不传入assembler，直接追加到命令末尾）
        extra_args = []
        if 'extra_args' in params:
            import shlex
            try:
                extra_args = shlex.split(str(params.pop('extra_args')))
            except Exception:
                extra_args = str(params.pop('extra_args')).split()
    
        cmd = None
        warnings = []
        if self.assembler and hasattr(self.assembler, 'assemble'):
            try:
                cmd, warnings = self.assembler.assemble(tool_name, params, auto_defaults=True)
            except Exception:
                # assembler 自身出错才回退到简单拼接（缺参不走这里）
                cmd = None
    
        if cmd is None:
            # 回退/无assembler：按模板做字面替换
            tool = self.tools.get(tool_name, {})
            path = tool.get('path', tool_name)
            cmd = [path]
            for arg in tool.get('args', []):
                replaced = arg
                for key, value in params.items():
                    replaced = replaced.replace('{' + key + '}', str(value) if value else '')
                cmd.append(replaced)
    
        # 缺参判定放在 assembler 的 try 之外：否则上面 raise 的 MissingToolParams
        # 会被「回退兜底」的 except Exception 吞掉，等于没生效。
        missing = [w.split(":", 1)[1].strip() for w in warnings
                   if "缺少必填参数" in w]
        if missing and strict:
            raise MissingToolParams(tool_name, missing, self._declared_slots(tool_name))
        for w in warnings:
            if "缺少必填参数" in w:
                print(f"[WARN] {w}")
    
        # 追加用户自定义的额外参数
        if extra_args:
            cmd.extend(extra_args)
        return cmd
