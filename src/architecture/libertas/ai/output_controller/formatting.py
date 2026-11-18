"""输出控制职责：formatting。"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .models import OutputFormat

class FormatTemplateEngine:
    """输出格式模板引擎"""

    # JSON格式系统提示
    JSON_SYSTEM_PROMPT = """你必须以严格的JSON格式回复。
规则：
1. 只输出JSON，不要输出任何其他文字
2. JSON必须是有效的，可以被json.loads()解析
3. 不要在JSON前后添加```json或```标记
4. 按照请求的结构输出字段"""

    # Markdown格式系统提示
    MARKDOWN_SYSTEM_PROMPT = """你必须以Markdown格式回复。
规则：
1. 使用标准Markdown语法
2. 标题使用#号层级
3. 列表使用-或数字
4. 代码使用```包裹并指定语言
5. 重要内容使用**加粗**"""

    # 代码格式系统提示
    CODE_SYSTEM_PROMPT = """你必须只输出代码。
规则：
1. 只输出代码本身，不要输出解释
2. 代码必须可以直接运行
3. 不要在代码前后添加```标记
4. 包含必要的导入和注释"""

    # 表格格式系统提示
    TABLE_SYSTEM_PROMPT = """你必须以Markdown表格格式回复。
规则：
1. 使用标准Markdown表格语法
2. 第一行是表头
3. 第二行是分隔线
4. 数据行对齐"""

    @staticmethod
    def get_system_prompt(output_format: OutputFormat) -> str:
        """获取格式对应的系统提示"""
        prompts = {
            OutputFormat.JSON: FormatTemplateEngine.JSON_SYSTEM_PROMPT,
            OutputFormat.MARKDOWN: FormatTemplateEngine.MARKDOWN_SYSTEM_PROMPT,
            OutputFormat.CODE: FormatTemplateEngine.CODE_SYSTEM_PROMPT,
            OutputFormat.TABLE: FormatTemplateEngine.TABLE_SYSTEM_PROMPT,
        }
        return prompts.get(output_format, "")

    @staticmethod
    def detect_format(content: str) -> OutputFormat:
        """检测输出内容的格式"""
        stripped = content.strip()

        # JSON检测
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                json.loads(stripped)
                return OutputFormat.JSON
            except (json.JSONDecodeError, ValueError):
                pass

        # XML检测
        if stripped.startswith("<") and stripped.endswith(">"):
            if re.match(r"^<\?xml", stripped) or re.match(r"^<\w+", stripped):
                return OutputFormat.XML

        # YAML检测
        if re.match(r"^[\w-]+:\s", stripped) and "\n" in stripped:
            return OutputFormat.YAML

        # Markdown检测
        markdown_indicators = ["#", "**", "```", "- ", "1. ", "| ", "> "]
        if any(ind in stripped for ind in markdown_indicators):
            return OutputFormat.MARKDOWN

        # 代码检测
        code_indicators = ["def ", "class ", "import ", "function ", "const ", "var "]
        if any(ind in stripped for ind in code_indicators) and not any(ind in stripped for ind in ["#", "**"]):
            return OutputFormat.CODE

        return OutputFormat.PLAIN_TEXT

    @staticmethod
    def validate_format(content: str, expected_format: OutputFormat) -> Tuple[bool, str]:
        """验证输出格式是否符合预期"""
        if expected_format == OutputFormat.JSON:
            try:
                json.loads(content.strip())
                return True, "valid_json"
            except (json.JSONDecodeError, ValueError) as e:
                return False, f"invalid_json: {str(e)[:100]}"

        if expected_format == OutputFormat.XML:
            try:
                import xml.etree.ElementTree as ET
                ET.fromstring(content)
                return True, "valid_xml"
            except Exception as e:
                return False, f"invalid_xml: {str(e)[:100]}"

        if expected_format == OutputFormat.MARKDOWN:
            # 基本Markdown验证
            if len(content.strip()) < 1:
                return False, "empty_content"
            return True, "markdown_accepted"

        if expected_format == OutputFormat.CODE:
            if len(content.strip()) < 1:
                return False, "empty_code"
            return True, "code_accepted"

        return True, "no_validation"

    @staticmethod
    def extract_json(content: str) -> Optional[str]:
        """从混合内容中提取JSON"""
        # 尝试直接解析
        stripped = content.strip()
        try:
            json.loads(stripped)
            return stripped
        except (json.JSONDecodeError, ValueError):
            pass

        # 尝试从```json块中提取
        json_block = re.search(r"```(?:json)?\s*\n(.*?)\n```", content, re.DOTALL)
        if json_block:
            try:
                json.loads(json_block.group(1).strip())
                return json_block.group(1).strip()
            except (json.JSONDecodeError, ValueError):
                pass

        # 尝试找到第一个{和最后一个}之间的内容
        first_brace = content.find("{")
        last_brace = content.rfind("}")
        if first_brace >= 0 and last_brace > first_brace:
            candidate = content[first_brace:last_brace + 1]
            try:
                json.loads(candidate)
                return candidate
            except (json.JSONDecodeError, ValueError):
                pass

        return None
