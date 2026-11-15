"""代码库模块职责：search。"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union

from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

from .indexer import ProjectIndexer

class CodeSearch:
    """代码语义搜索 - 按功能描述搜索代码"""

    def __init__(self, indexer: ProjectIndexer):
        self.search_id = f"search_{uuid.uuid4().hex[:8]}"
        self.indexer = indexer

    def search(self, query: str, limit: int = 10,
               symbol_type: str = "", file_type: str = "") -> List[Dict[str, Any]]:
        """搜索代码"""
        results = []
        query_lower = query.lower()
        query_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', query_lower))

        # 搜索符号
        for symbol in self.indexer.symbols.values():
            if symbol_type and symbol.symbol_type != symbol_type:
                continue
            score = 0
            # 名称匹配
            if query_lower in symbol.name.lower():
                score += 20
            # 文档字符串匹配
            if symbol.docstring and query_lower in symbol.docstring.lower():
                score += 15
            # 关键词匹配
            name_words = set(re.findall(r'[a-zA-Z0-9]+', symbol.name.lower()))
            doc_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+',
                                       symbol.docstring.lower() if symbol.docstring else ""))
            all_words = name_words | doc_words
            overlap = len(query_words & all_words)
            score += overlap * 3
            # 参数匹配
            for param in symbol.parameters:
                if query_lower in param.lower():
                    score += 5
            if score > 0:
                code_file = self.indexer.get_file(symbol.file_path)
                results.append({
                    "type": "symbol",
                    "score": score,
                    "symbol": symbol.to_dict(),
                    "file_path": symbol.file_path,
                    "line": symbol.line_start,
                    "snippet": code_file.get_lines(symbol.line_start,
                                                    min(symbol.line_start + 5, symbol.line_end))
                    if code_file else "",
                })

        # 搜索文件内容
        if file_type or not symbol_type:
            for file_path, code_file in self.indexer.files.items():
                if file_type and code_file.language != file_type:
                    continue
                content_lower = code_file.content.lower()
                score = 0
                if query_lower in content_lower:
                    score += 10
                content_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z0-9]+', content_lower))
                overlap = len(query_words & content_words)
                score += overlap * 2
                if score > 0:
                    # 找到匹配行
                    match_line = 0
                    for i, line in enumerate(code_file.lines):
                        if query_lower in line.lower():
                            match_line = i + 1
                            break
                    results.append({
                        "type": "file",
                        "score": score,
                        "file_path": file_path,
                        "line": match_line,
                        "language": code_file.language,
                        "snippet": code_file.get_lines(max(1, match_line - 2),
                                                       min(code_file.line_count, match_line + 3)),
                    })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def search_by_regex(self, pattern: str, file_type: str = "",
                        limit: int = 20) -> List[Dict[str, Any]]:
        """正则表达式搜索"""
        results = []
        try:
            regex = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return [{"error": f"无效正则: {e}"}]

        for file_path, code_file in self.indexer.files.items():
            if file_type and code_file.language != file_type:
                continue
            for i, line in enumerate(code_file.lines):
                if regex.search(line):
                    results.append({
                        "file_path": file_path,
                        "line": i + 1,
                        "content": line.strip()[:200],
                        "language": code_file.language,
                    })
                    if len(results) >= limit:
                        return results
        return results

    def find_definition(self, name: str) -> Optional[Dict[str, Any]]:
        """查找符号定义"""
        matches = self.indexer.find_symbol_by_name(name)
        if matches:
            symbol = matches[0]
            code_file = self.indexer.get_file(symbol.file_path)
            return {
                "symbol": symbol.to_dict(),
                "file_path": symbol.file_path,
                "line": symbol.line_start,
                "source": code_file.get_lines(symbol.line_start, symbol.line_end) if code_file else "",
            }
        return None

    def find_references(self, name: str) -> List[Dict[str, Any]]:
        """查找符号引用"""
        return self.search_by_regex(rf'\b{re.escape(name)}\b')
