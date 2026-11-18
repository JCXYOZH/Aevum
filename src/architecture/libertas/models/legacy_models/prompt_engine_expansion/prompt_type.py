"""
models/prompt_engine_expansion.py - 提示词引擎综合扩展模块

高级提示词管理：提示词模板库、提示词优化器、少样本示例管理器、
提示词版本控制、提示词A/B测试、提示词效果评估器、动态提示词组装器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 提示词类型
# ================================================================

class PromptType(Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    FUNCTION = "function"
    FEW_SHOT = "few_shot"
    CHAIN_OF_THOUGHT = "chain_of_thought"
    ROLE_PLAY = "role_play"
    INSTRUCTION = "instruction"
    CONTEXT = "context"

class PromptTemplate:
    """提示词模板"""

    def __init__(self, name: str = "", content: str = "",
                 prompt_type: str = "instruction",
                 description: str = "",
                 variables: Optional[List[str]] = None,
                 tags: Optional[List[str]] = None,
                 version: str = "1.0.0"):
        self.template_id = f"tpl_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.content = content
        self.prompt_type = prompt_type
        self.description = description
        self.variables = variables or self._extract_variables(content)
        self.tags = tags or []
        self.version = version
        self.created_at = time.time()
        self.updated_at = time.time()
        self.usage_count = 0
        self.avg_quality_score = 0.0
        self.quality_scores: deque = deque(maxlen=100)
        self.author = ""
        self.is_active = True
        self.parent_id = ""
        self.change_log: List[Dict[str, Any]] = []
        self.metadata: Dict[str, Any] = {}

    def _extract_variables(self, content: str) -> List[str]:
        """从模板中提取变量（{variable}格式）"""
        return list(set(re.findall(r'\{(\w+)\}', content)))

    def render(self, variables: Optional[Dict[str, str]] = None,
               **kwargs) -> str:
        """渲染模板"""
        all_vars = dict(variables or {})
        all_vars.update(kwargs)
        try:
            return self.content.format(**all_vars)
        except KeyError as e:
            # 缺少变量时保留原始占位符
            result = self.content
            for key in self.variables:
                if key not in all_vars:
                    result = result.replace(f"{{{key}}}", f"[{key}未提供]")
            return result

    def validate(self) -> Tuple[bool, List[str]]:
        """验证模板"""
        errors = []
        if not self.content.strip():
            errors.append("模板内容为空")
        if not self.name.strip():
            errors.append("模板名称为空")
        # 检查变量是否平衡
        open_braces = self.content.count("{")
        close_braces = self.content.count("}")
        if open_braces != close_braces:
            errors.append(f"花括号不匹配 ({{: {open_braces}, }}: {close_braces})")
        return len(errors) == 0, errors

    def to_dict(self) -> Dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "content": self.content[:500],
            "prompt_type": self.prompt_type,
            "description": self.description,
            "variables": self.variables,
            "tags": self.tags,
            "version": self.version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "usage_count": self.usage_count,
            "avg_quality_score": round(self.avg_quality_score, 4),
            "is_active": self.is_active,
        }

class FewShotExample:
    """少样本示例"""

    def __init__(self, input_text: str = "", output_text: str = "",
                 explanation: str = "", category: str = "general",
                 difficulty: int = 1):
        self.example_id = f"ex_{uuid.uuid4().hex[:8]}"
        self.input_text = input_text
        self.output_text = output_text
        self.explanation = explanation
        self.category = category
        self.difficulty = difficulty  # 1-5
        self.created_at = time.time()
        self.usage_count = 0
        self.helpfulness_score = 0.0
        self.tags: List[str] = []
        self.metadata: Dict[str, Any] = {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "example_id": self.example_id,
            "input_text": self.input_text[:200],
            "output_text": self.output_text[:200],
            "explanation": self.explanation[:200],
            "category": self.category,
            "difficulty": self.difficulty,
            "usage_count": self.usage_count,
            "helpfulness_score": round(self.helpfulness_score, 4),
            "tags": self.tags,
        }

class PromptTemplateLibrary:
    """提示词模板库"""

    def __init__(self, data_dir: str = ""):
        self.library_id = f"lib_{uuid.uuid4().hex[:8]}"
        self.templates: Dict[str, PromptTemplate] = {}
        self.categories: Dict[str, List[str]] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self):
        pass  # 持久化待实现

    def create_template(self, name: str, content: str,
                        prompt_type: str = "instruction",
                        description: str = "",
                        tags: Optional[List[str]] = None) -> PromptTemplate:
        template = PromptTemplate(name, content, prompt_type, description, tags=tags)
        with self._lock:
            self.templates[template.template_id] = template
            for tag in template.tags:
                if tag not in self.categories:
                    self.categories[tag] = []
                self.categories[tag].append(template.template_id)
        terminal.info(f"创建提示词模板: {name}", "prompt_library")
        return template

    def get_template(self, template_id: str) -> Optional[PromptTemplate]:
        return self.templates.get(template_id)

    def get_template_by_name(self, name: str) -> Optional[PromptTemplate]:
        for t in self.templates.values():
            if t.name == name:
                return t
        return None

    def update_template(self, template_id: str, content: str = "",
                        description: str = "", tags: Optional[List[str]] = None) -> bool:
        template = self.templates.get(template_id)
        if not template:
            return False
        if content:
            old_content = template.content
            template.content = content
            template.variables = template._extract_variables(content)
            template.change_log.append({
                "version": template.version,
                "changed_at": time.time(),
                "old_content_preview": old_content[:100],
                "new_content_preview": content[:100],
            })
            # 版本号递增
            parts = template.version.split(".")
            parts[-1] = str(int(parts[-1]) + 1)
            template.version = ".".join(parts)
        if description:
            template.description = description
        if tags is not None:
            template.tags = tags
        template.updated_at = time.time()
        return True

    def delete_template(self, template_id: str) -> bool:
        with self._lock:
            template = self.templates.pop(template_id, None)
            if template:
                for tag in template.tags:
                    if tag in self.categories:
                        self.categories[tag] = [
                            tid for tid in self.categories[tag] if tid != template_id
                        ]
                return True
        return False

    def list_templates(self, category: str = "", prompt_type: str = "",
                       active_only: bool = True) -> List[PromptTemplate]:
        templates = list(self.templates.values())
        if category:
            template_ids = set(self.categories.get(category, []))
            templates = [t for t in templates if t.template_id in template_ids]
        if prompt_type:
            templates = [t for t in templates if t.prompt_type == prompt_type]
        if active_only:
            templates = [t for t in templates if t.is_active]
        templates.sort(key=lambda t: t.usage_count, reverse=True)
        return templates

    def search_templates(self, query: str, limit: int = 10) -> List[PromptTemplate]:
        """搜索模板"""
        query_lower = query.lower()
        results = []
        for template in self.templates.values():
            score = 0
            if query_lower in template.name.lower():
                score += 10
            if query_lower in template.description.lower():
                score += 5
            if query_lower in template.content.lower():
                score += 3
            if any(query_lower in tag.lower() for tag in template.tags):
                score += 7
            if score > 0:
                results.append((template, score))
        results.sort(key=lambda x: x[1], reverse=True)
        return [r[0] for r in results[:limit]]

    def render_template(self, template_id: str,
                        variables: Optional[Dict[str, str]] = None) -> Optional[str]:
        template = self.get_template(template_id)
        if template:
            template.usage_count += 1
            return template.render(variables)
        return None

    def get_stats(self) -> Dict[str, Any]:
        return {
            "library_id": self.library_id,
            "total_templates": len(self.templates),
            "active_templates": sum(1 for t in self.templates.values() if t.is_active),
            "categories": len(self.categories),
            "total_usage": sum(t.usage_count for t in self.templates.values()),
            "by_type": {t: sum(1 for x in self.templates.values() if x.prompt_type == t)
                        for t in set(x.prompt_type for x in self.templates.values())},
        }
