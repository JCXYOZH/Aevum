"""
security/fuzzer.py - 模糊测试引擎

核心能力：
- ParameterFuzzer: 参数模糊测试（超长字符串、特殊字符、类型混淆、边界值）
- FormatFuzzer: 格式模糊测试（JSON/XML/CSV/Multipart格式变异）
- MutationEngine: 变异引擎（15种变异策略，基于种子的智能变异）
- FuzzerOrchestrator: 模糊测试编排器（并发、进度、结果聚合、崩溃检测）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import string
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


# ================================================================
# 变异引擎
# ================================================================
from .mutation_strategy import *  # noqa: F401,F403

class MutationEngine:
    """变异引擎

    基于种子输入的智能变异，支持20种变异策略。
    用于模糊测试和漏洞挖掘的payload生成。
    """

    def __init__(self, seed: str = None, max_mutations: int = 100):
        self.seed = seed or "test"
        self.max_mutations = max_mutations
        self.interesting_values = self._init_interesting_values()
        self.special_chars = self._init_special_chars()
        self.mutation_history = []

    def _init_interesting_values(self) -> List[Any]:
        """初始化有趣值（边界值、特殊值）"""
        return [
            # 数字边界
            0, 1, -1, 255, 256, 65535, 65536,
            2147483647, 2147483648, -2147483648,
            4294967295, 4294967296,
            # 特殊值
            "0", "00", "0x00", "0xdeadbeef",
            "NaN", "Infinity", "-Infinity",
            "true", "false", "null", "undefined",
            "None", "nil",
            # 格式字符串
            "%s", "%d", "%x", "%n", "%p",
            "%s%s%s%s%s", "%n%n%n%n%n",
            # 路径遍历
            "../", "..\\", "/etc/passwd",
            "..%2f", "..%5c",
            # SQL
            "'", "\"", " OR 1=1--", "' OR '1'='1",
            # XSS
            "<script>", "<img src=x onerror=alert(1)>",
            "javascript:alert(1)",
            # 命令注入
            ";", "|", "&&", "`", "$(",
            # 空字节
            "\x00", "%00",
        ]

    def _init_special_chars(self) -> str:
        """初始化特殊字符集"""
        return (
            string.punctuation +  # !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
            string.whitespace +
            "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f"
            "\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f"
            "\x7f\xff\xfe"
        )

    def mutate(self, input_data: str, strategy: MutationStrategy = None,
               count: int = 1) -> List[str]:
        """对输入数据执行变异"""
        if strategy is None:
            strategy = random.choice(list(MutationStrategy))

        results = []
        for _ in range(min(count, self.max_mutations)):
            try:
                mutated = self._apply_mutation(input_data, strategy)
                if mutated != input_data and mutated not in results:
                    results.append(mutated)
                    self.mutation_history.append({
                        "strategy": strategy.value,
                        "input": input_data[:50],
                        "output": mutated[:50],
                        "timestamp": time.time(),
                    })
            except Exception:
                continue
        return results

    def _apply_mutation(self, data: str, strategy: MutationStrategy) -> str:
        """应用单个变异策略"""
        if not data:
            data = self.seed

        data_bytes = data.encode('utf-8', errors='replace')
        result = data

        if strategy == MutationStrategy.BIT_FLIP:
            result = self._bit_flip(data_bytes)
        elif strategy == MutationStrategy.BYTE_FLIP:
            result = self._byte_flip(data_bytes)
        elif strategy == MutationStrategy.ARITHMETIC:
            result = self._arithmetic(data)
        elif strategy == MutationStrategy.INTERESTING_VALUE:
            result = self._interesting_value(data)
        elif strategy == MutationStrategy.OVERWRITE:
            result = self._overwrite(data)
        elif strategy == MutationStrategy.INSERT:
            result = self._insert(data)
        elif strategy == MutationStrategy.DELETE:
            result = self._delete(data)
        elif strategy == MutationStrategy.DUPLICATE:
            result = self._duplicate(data)
        elif strategy == MutationStrategy.TRUNCATE:
            result = self._truncate(data)
        elif strategy == MutationStrategy.EXTEND:
            result = self._extend(data)
        elif strategy == MutationStrategy.REPLACE_CHAR:
            result = self._replace_char(data)
        elif strategy == MutationStrategy.INSERT_SPECIAL:
            result = self._insert_special(data)
        elif strategy == MutationStrategy.FORMAT_STRING:
            result = self._format_string(data)
        elif strategy == MutationStrategy.SQL_INJECTION:
            result = self._sql_injection(data)
        elif strategy == MutationStrategy.XSS_PAYLOAD:
            result = self._xss_payload(data)
        elif strategy == MutationStrategy.COMMAND_INJECTION:
            result = self._command_injection(data)
        elif strategy == MutationStrategy.PATH_TRAVERSAL:
            result = self._path_traversal(data)
        elif strategy == MutationStrategy.NULL_BYTE:
            result = self._null_byte(data)
        elif strategy == MutationStrategy.UNICODE_MANGLE:
            result = self._unicode_mangle(data)
        elif strategy == MutationStrategy.ENCODING_BYPASS:
            result = self._encoding_bypass(data)

        return result

    def _bit_flip(self, data: bytes) -> str:
        """位翻转"""
        if not data:
            return data.decode('utf-8', errors='replace')
        result = bytearray(data)
        pos = random.randint(0, len(result) - 1)
        bit = random.randint(0, 7)
        result[pos] ^= (1 << bit)
        return result.decode('utf-8', errors='replace')

    def _byte_flip(self, data: bytes) -> str:
        """字节翻转"""
        if not data:
            return data.decode('utf-8', errors='replace')
        result = bytearray(data)
        pos = random.randint(0, len(result) - 1)
        result[pos] ^= random.randint(1, 255)
        return result.decode('utf-8', errors='replace')

    def _arithmetic(self, data: str) -> str:
        """算术变异（数字加减）"""
        nums = re.findall(r'\d+', data)
        if not nums:
            return data + str(random.randint(-100, 100))
        num = random.choice(nums)
        delta = random.choice([-1, 1, -10, 10, -100, 100, -1000, 1000])
        new_val = str(max(0, int(num) + delta))
        return data.replace(num, new_val, 1)

    def _interesting_value(self, data: str) -> str:
        """有趣值替换"""
        val = random.choice(self.interesting_values)
        if isinstance(val, int):
            val = str(val)
        if data:
            pos = random.randint(0, len(data))
            return data[:pos] + val + data[pos:]
        return val

    def _overwrite(self, data: str) -> str:
        """覆盖写入"""
        if not data:
            return "A" * random.randint(1, 100)
        result = list(data)
        length = min(len(result), random.randint(1, 50))
        start = random.randint(0, len(result) - length)
        for i in range(start, start + length):
            result[i] = random.choice(self.special_chars)
        return ''.join(result)

    def _insert(self, data: str) -> str:
        """插入"""
        insert_str = ''.join(random.choices(self.special_chars, k=random.randint(1, 50)))
        pos = random.randint(0, len(data))
        return data[:pos] + insert_str + data[pos:]

    def _delete(self, data: str) -> str:
        """删除"""
        if len(data) < 2:
            return data
        length = random.randint(1, min(len(data) // 2, 50))
        start = random.randint(0, len(data) - length)
        return data[:start] + data[start + length:]

    def _duplicate(self, data: str) -> str:
        """重复"""
        if not data:
            return data
        length = random.randint(1, min(len(data), 100))
        start = random.randint(0, len(data) - length)
        segment = data[start:start + length]
        repeat = random.randint(2, 10)
        return data[:start] + segment * repeat + data[start + length:]

    def _truncate(self, data: str) -> str:
        """截断"""
        if len(data) < 2:
            return data
        length = random.randint(1, len(data) - 1)
        return data[:length]

    def _extend(self, data: str) -> str:
        """扩展"""
        extension = ''.join(random.choices(
            string.ascii_letters + string.digits + self.special_chars,
            k=random.randint(10, 5000)
        ))
        return data + extension

    def _replace_char(self, data: str) -> str:
        """字符替换"""
        if not data:
            return data
        result = list(data)
        pos = random.randint(0, len(result) - 1)
        result[pos] = random.choice(self.special_chars)
        return ''.join(result)

    def _insert_special(self, data: str) -> str:
        """插入特殊字符"""
        special = random.choice(["'", '"', '<', '>', ';', '|', '&', '$',
                                   '(', ')', '{', '}', '[', ']', '\\', '/',
                                   '\x00', '\n', '\r', '\t'])
        pos = random.randint(0, len(data))
        return data[:pos] + special + data[pos:]

    def _format_string(self, data: str) -> str:
        """格式字符串"""
        fmt = random.choice(["%s", "%d", "%x", "%n", "%p", "%s" * 10, "%n" * 10])
        return data + fmt

    def _sql_injection(self, data: str) -> str:
        """SQL注入payload"""
        payloads = ["'", "\"", "' OR 1=1--", "\" OR 1=1--",
                    "' OR '1'='1", "1; DROP TABLE users--",
                    "1' UNION SELECT NULL--", "admin'--"]
        return data + random.choice(payloads)

    def _xss_payload(self, data: str) -> str:
        """XSS payload"""
        payloads = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>",
                    "javascript:alert(1)", "<svg onload=alert(1)>",
                    "\"><script>alert(1)</script>", "'><script>alert(1)</script>"]
        return data + random.choice(payloads)

    def _command_injection(self, data: str) -> str:
        """命令注入payload"""
        payloads = ["; id", "| id", "&& id", "`id`", "$(id)",
                    "; ls -la", "| cat /etc/passwd"]
        return data + random.choice(payloads)

    def _path_traversal(self, data: str) -> str:
        """路径遍历payload"""
        payloads = ["../../../etc/passwd", "..\\..\\..\\windows\\win.ini",
                    "....//....//....//etc/passwd", "%2e%2e%2f%2e%2e%2fetc/passwd"]
        return data + random.choice(payloads)

    def _null_byte(self, data: str) -> str:
        """空字节注入"""
        pos = random.randint(0, len(data))
        return data[:pos] + "\x00" + data[pos:]

    def _unicode_mangle(self, data: str) -> str:
        """Unicode混淆"""
        if not data:
            return data
        result = []
        for c in data:
            if random.random() < 0.3 and c.isascii():
                # 替换为看起来相似的Unicode字符
                similar = {'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р',
                           'c': 'с', 'x': 'х', 'A': 'А', 'B': 'В',
                           'C': 'С', 'E': 'Е', 'H': 'Н', 'K': 'К',
                           'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т',
                           'X': 'Х'}
                result.append(similar.get(c, c))
            else:
                result.append(c)
        return ''.join(result)

    def _encoding_bypass(self, data: str) -> str:
        """编码绕过"""
        encoding = random.choice(["url", "double_url", "unicode", "hex", "html"])
        if encoding == "url":
            return ''.join(f'%{ord(c):02x}' if c in self.special_chars else c for c in data)
        elif encoding == "double_url":
            return ''.join(f'%25{ord(c):02x}' if c in self.special_chars else c for c in data)
        elif encoding == "unicode":
            return ''.join(f'\\u{ord(c):04x}' for c in data)
        elif encoding == "hex":
            return data.encode('utf-8').hex()
        elif encoding == "html":
            return ''.join(f'&#{ord(c)};' for c in data)
        return data

    def generate_mutations(self, seed: str, count: int = 50,
                            strategies: List[MutationStrategy] = None) -> List[str]:
        """生成一批变异样本"""
        if strategies is None:
            strategies = list(MutationStrategy)

        results = []
        per_strategy = max(1, count // len(strategies))

        for strategy in strategies:
            mutations = self.mutate(seed, strategy, per_strategy)
            results.extend(mutations)

        # 去重并限制数量
        seen = set()
        unique = []
        for r in results:
            if r not in seen:
                seen.add(r)
                unique.append(r)
            if len(unique) >= count:
                break

        return unique

    def get_stats(self) -> Dict:
        return {
            "total_mutations": len(self.mutation_history),
            "strategies": len(MutationStrategy),
            "interesting_values": len(self.interesting_values),
            "by_strategy": dict(Counter(h["strategy"] for h in self.mutation_history)),
        }
