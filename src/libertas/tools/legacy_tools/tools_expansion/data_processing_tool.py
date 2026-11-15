"""
tools/tools_expansion.py - 工具集综合扩展模块

新增高级工具：网络侦察工具集、密码学工具集、数据处理工具集、
系统管理工具集、文件分析工具集、文本处理工具集。
"""
import os
import json
import time
import uuid
import math
import hashlib
import hmac
import base64
import socket
import struct
import threading
import subprocess
import re
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.byte_stream import safe_decode
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 网络侦察工具集
# ================================================================


class DataProcessingTool:
    """数据处理工具"""

    def __init__(self):
        self.tool_id = f"dpt_{uuid.uuid4().hex[:8]}"

    def deduplicate(self, items: List[Any]) -> List[Any]:
        """去重（保持顺序）"""
        seen = set()
        result = []
        for item in items:
            key = json.dumps(item, sort_keys=True, default=str) if isinstance(item, (dict, list)) else item
            if key not in seen:
                seen.add(key)
                result.append(item)
        return result

    def merge_dicts(self, dict_list: List[Dict[str, Any]],
                    strategy: str = "update") -> Dict[str, Any]:
        """合并字典"""
        result = {}
        for d in dict_list:
            if strategy == "update":
                result.update(d)
            elif strategy == "sum":
                for k, v in d.items():
                    if isinstance(v, (int, float)):
                        result[k] = result.get(k, 0) + v
                    else:
                        result[k] = v
            elif strategy == "concat":
                for k, v in d.items():
                    if k in result:
                        if isinstance(result[k], list):
                            result[k].extend(v if isinstance(v, list) else [v])
                        else:
                            result[k] = [result[k], v]
                    else:
                        result[k] = v
        return result

    def flatten_dict(self, d: Dict[str, Any], prefix: str = "",
                     separator: str = ".") -> Dict[str, Any]:
        """扁平化字典"""
        result = {}
        for key, value in d.items():
            new_key = f"{prefix}{separator}{key}" if prefix else key
            if isinstance(value, dict):
                result.update(self.flatten_dict(value, new_key, separator))
            else:
                result[new_key] = value
        return result

    def unflatten_dict(self, flat: Dict[str, Any],
                       separator: str = ".") -> Dict[str, Any]:
        """反扁平化字典"""
        result = {}
        for key, value in flat.items():
            parts = key.split(separator)
            current = result
            for part in parts[:-1]:
                if part not in current:
                    current[part] = {}
                current = current[part]
            current[parts[-1]] = value
        return result

    def chunk_list(self, items: List[Any], chunk_size: int) -> List[List[Any]]:
        """列表分块"""
        return [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]

    def sliding_window(self, items: List[Any], window_size: int) -> List[List[Any]]:
        """滑动窗口"""
        return [items[i:i + window_size] for i in range(len(items) - window_size + 1)]

    def frequency_count(self, items: List[Any]) -> Dict[Any, int]:
        """频率统计"""
        return dict(Counter(items))

    def top_n(self, items: List[Any], n: int = 10) -> List[Tuple[Any, int]]:
        """Top N 频率"""
        return Counter(items).most_common(n)

    def normalize(self, values: List[float]) -> List[float]:
        """归一化（0-1）"""
        if not values:
            return []
        min_val = min(values)
        max_val = max(values)
        if max_val == min_val:
            return [0.5] * len(values)
        return [(v - min_val) / (max_val - min_val) for v in values]

    def standardize(self, values: List[float]) -> List[float]:
        """标准化（Z-score）"""
        if not values:
            return []
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        std = math.sqrt(variance)
        if std == 0:
            return [0.0] * len(values)
        return [(v - mean) / std for v in values]

    def moving_average(self, values: List[float], window: int = 3) -> List[float]:
        """移动平均"""
        if window <= 0 or not values:
            return []
        result = []
        for i in range(len(values)):
            start = max(0, i - window + 1)
            window_vals = values[start:i + 1]
            result.append(sum(window_vals) / len(window_vals))
        return result

    def exponential_smoothing(self, values: List[float],
                               alpha: float = 0.3) -> List[float]:
        """指数平滑"""
        if not values:
            return []
        result = [values[0]]
        for v in values[1:]:
            result.append(alpha * v + (1 - alpha) * result[-1])
        return result

    def get_stats(self) -> Dict[str, Any]:
        return {"tool_id": self.tool_id}
