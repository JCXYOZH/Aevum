"""动态提示词职责：models。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir


class PromptComponent:
    """提示词组件（支持条件渲染、变量替换、循环）"""

    def __init__(self, name: str = "", content: str = "",
                 component_type: str = "general", priority: int = 0,
                 enabled: bool = True, conditions: Optional[Dict[str, Any]] = None,
                 variables: Optional[Dict[str, str]] = None,
                 dependencies: Optional[List[str]] = None,
                 description: str = ""):
        self.name = name
        self.content = content
        self.component_type = component_type
        self.priority = priority
        self.enabled = enabled
        self.conditions = conditions or {}
        self.variables = variables or {}
        self.dependencies = dependencies or []
        self.description = description

    def render(self, context: Optional[Dict[str, Any]] = None) -> str:
        """渲染组件"""
        context = context or {}
        if not self._check_conditions(context):
            return ""
        text = self.content
        text = self._apply_variables(text, context)
        text = self._apply_conditionals(text, context)
        text = self._apply_loops(text, context)
        return text.strip()

    def _check_conditions(self, context: Optional[Dict[str, Any]]) -> bool:
        """检查条件是否满足"""
        if not self.conditions:
            return True
        for key, expected in self.conditions.items():
            actual = context.get(key)
            if actual != expected:
                return False
        return True

    def _apply_variables(self, text: str, context: Dict[str, Any]) -> str:
        """应用变量替换 {{ variable }}"""
        def replace(match):
            var_name = match.group(1).strip()
            value = context.get(var_name, self.variables.get(var_name, match.group(0)))
            return str(value)
        return re.sub(r'\{\{\s*([^}]+?)\s*\}\}', replace, text)

    def _apply_conditionals(self, text: str, context: Dict[str, Any]) -> str:
        """应用条件语句 {% if condition %} ... {% endif %}"""
        pattern = r'\{%\s*if\s+([^%]+?)\s*%\}(.*?)\{%\s*endif\s*%\}'
        def replace(match):
            condition = match.group(1).strip()
            body = match.group(2)
            # 简单条件判断：支持 key, not key, key == value
            if condition.startswith("not "):
                key = condition[4:].strip()
                if not context.get(key, False):
                    return body
                return ""
            elif "==" in condition:
                key, value = condition.split("==", 1)
                key = key.strip()
                value = value.strip().strip("'\"")
                if str(context.get(key, "")) == value:
                    return body
                return ""
            else:
                if context.get(condition, False):
                    return body
                return ""
        return re.sub(pattern, replace, text, flags=re.DOTALL)

    def _apply_loops(self, text: str, context: Dict[str, Any]) -> str:
        """应用循环 {% for item in list %} ... {% endfor %}"""
        pattern = r'\{%\s*for\s+(\w+)\s+in\s+([^%]+?)\s*%\}(.*?)\{%\s*endfor\s*%\}'
        def replace(match):
            item_var = match.group(1)
            list_name = match.group(2).strip()
            body = match.group(3)
            items = context.get(list_name, [])
            if not isinstance(items, list):
                return ""
            result = []
            for item in items:
                item_context = dict(context)
                item_context[item_var] = item
                # 对循环体应用变量替换
                rendered = body
                for key, value in item_context.items():
                    if isinstance(value, (str, int, float, bool)):
                        rendered = rendered.replace("{{ " + key + " }}", str(value))
                result.append(rendered)
            return "\n".join(result)
        return re.sub(pattern, replace, text, flags=re.DOTALL)

    def estimate_tokens(self) -> int:
        """估算token数（简单估算：中文字符1 token，英文4字符1 token）"""
        text = self.content
        chinese = len(re.findall(r'[\u4e00-\u9fff]', text))
        other = len(text) - chinese
        return chinese + max(1, other // 4)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "content": self.content,
            "component_type": self.component_type,
            "priority": self.priority,
            "enabled": self.enabled,
            "conditions": self.conditions,
            "variables": self.variables,
            "dependencies": self.dependencies,
            "description": self.description,
        }

class PromptTemplate:
    """提示词模板"""

    def __init__(self, name: str = "", description: str = "",
                 components: Optional[List[str]] = None,
                 system_prompt: str = "", user_prompt: str = "",
                 max_tokens: int = 4096):
        self.name = name
        self.description = description
        self.components = components or []
        self.system_prompt = system_prompt
        self.user_prompt = user_prompt
        self.max_tokens = max_tokens

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "components": self.components,
            "system_prompt": self.system_prompt,
            "user_prompt": self.user_prompt,
            "max_tokens": self.max_tokens,
        }
