"""动态提示词职责：singleton。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir

from .assembler import DynamicPromptAssembler

_prompt_assembler = DynamicPromptAssembler()

def get_prompt_assembler() -> DynamicPromptAssembler:
    return _prompt_assembler

def assemble_prompt(**kwargs) -> Dict[str, Any]:
    return _prompt_assembler.assemble(**kwargs)

def build_dynamic_context(intent: Dict[str, Any],
                           matched_tools: List[Dict] = None,
                           tool_help_texts: Dict[str, str] = None,
                           search_results_summary: str = "",
                           settings: Dict[str, Any] = None) -> str:
    """构建动态上下文（吸收0.1.5，模块级函数）"""
    return _prompt_assembler.build_dynamic_context(
        intent, matched_tools, tool_help_texts, search_results_summary, settings
    )

def build_function_definitions(matched_tools: List[Dict],
                                tool_help_texts: Dict[str, str] = None) -> List[Dict]:
    """构建函数定义（吸收0.1.5，模块级函数）"""
    return _prompt_assembler.build_function_definitions(matched_tools, tool_help_texts)
