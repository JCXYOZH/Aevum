# tools/parsers.py
"""
工具输出解析器集合
每个解析器函数接收 raw_output 和 params，返回结构化数据
"""
import json
import re
import sys
from typing import Dict, Any
from libertas.utils.text_decode import read_text_auto, read_lines_auto, describe_exception

from .registry import PARSER_MAP


def parse_tool_result(tool_name: str, raw_output: str, params: dict = None) -> dict:
    """统一解析入口。根据工具名分发到对应解析器，无匹配时返回None。"""
    if params is None:
        params = {}
    params["target"] = params.get("target", "")
    parser_fn = PARSER_MAP.get(tool_name)
    if parser_fn:
        try:
            result = parser_fn(raw_output, params)
            result["_parsed"] = True
            result["_tool"] = tool_name
            return result
        except Exception as e:
            return {"_parsed": False, "_tool": tool_name, "error": str(e)[:200]}
    return {"_parsed": False, "_tool": tool_name}
