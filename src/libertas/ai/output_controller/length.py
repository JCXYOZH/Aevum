"""输出控制职责：length。"""

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

from .constants import LENGTH_PRESETS
from .models import OutputConfig
from .models import OutputFormat
from .constants import TASK_COMPLEXITY_MAP

class LengthController:
    """输出长度控制器"""

    @staticmethod
    def get_config_for_task(task_type: str, complexity: str = "medium") -> OutputConfig:
        """根据任务类型获取输出配置"""
        preset_name = TASK_COMPLEXITY_MAP.get(task_type, "medium")

        # 根据复杂度调整
        complexity_multiplier = {
            "very_low": 0.5,
            "low": 0.75,
            "medium": 1.0,
            "high": 1.5,
            "very_high": 2.0,
        }
        multiplier = complexity_multiplier.get(complexity, 1.0)

        preset = LENGTH_PRESETS.get(preset_name, LENGTH_PRESETS["medium"])
        config = OutputConfig(
            length_preset=preset_name,
            max_tokens=int(preset["max_tokens"] * multiplier),
            max_chars=int(preset["max_chars"] * multiplier),
            target_sentences=int(preset["target_sentences"] * multiplier),
        )
        return config

    @staticmethod
    def estimate_tokens(text: str) -> int:
        """估算文本的token数（粗略估算）"""
        # 中文约1.5字符/token，英文约4字符/token
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        other_chars = len(text) - chinese_chars
        return int(chinese_chars / 1.5 + other_chars / 4)

    @staticmethod
    def smart_truncate(content: str, max_chars: int,
                        format_type: OutputFormat = OutputFormat.PLAIN_TEXT) -> Tuple[str, bool]:
        """
        智能截断：不在JSON/代码/句子中间切断

        Returns:
            (截断后的内容, 是否被截断)
        """
        if len(content) <= max_chars:
            return content, False

        if format_type == OutputFormat.JSON:
            return LengthController._truncate_json(content, max_chars)

        if format_type == OutputFormat.CODE:
            return LengthController._truncate_code(content, max_chars)

        if format_type == OutputFormat.MARKDOWN:
            return LengthController._truncate_markdown(content, max_chars)

        # 纯文本：在句子边界截断
        truncated = content[:max_chars]
        last_period = max(truncated.rfind("。"), truncated.rfind("."),
                          truncated.rfind("！"), truncated.rfind("!"),
                          truncated.rfind("？"), truncated.rfind("?"))
        if last_period > max_chars * 0.5:
            truncated = truncated[:last_period + 1]

        return truncated + "\n\n... [内容已截断]", True

    @staticmethod
    def _truncate_json(content: str, max_chars: int) -> Tuple[str, bool]:
        """截断JSON（保留结构有效性）"""
        try:
            data = json.loads(content)
            if isinstance(data, dict):
                # 截断数组和长字符串
                truncated = {}
                current_size = 2  # {}
                for key, value in data.items():
                    item_str = json.dumps({key: value}, ensure_ascii=False)
                    if current_size + len(item_str) > max_chars * 0.8:
                        if isinstance(value, list):
                            truncated[key] = value[:max(1, len(value) // 4)]
                            truncated[key + "_truncated"] = f"共{len(value)}项，仅显示前{len(truncated[key])}项"
                        elif isinstance(value, str) and len(value) > 200:
                            truncated[key] = value[:200] + "...[截断]"
                        else:
                            continue
                    else:
                        truncated[key] = value
                    current_size = len(json.dumps(truncated, ensure_ascii=False))

                result = json.dumps(truncated, ensure_ascii=False, indent=2)
                return result, True

            elif isinstance(data, list):
                keep_count = max(1, int(len(data) * max_chars / len(content)))
                truncated = data[:keep_count]
                result = json.dumps(truncated, ensure_ascii=False, indent=2)
                result += f"\n\n// 共{len(data)}项，仅显示前{keep_count}项"
                return result, True

        except (json.JSONDecodeError, ValueError):
            pass

        # 无法解析JSON，普通截断
        return content[:max_chars] + "\n... [JSON截断，可能不完整]", True

    @staticmethod
    def _truncate_code(content: str, max_chars: int) -> Tuple[str, bool]:
        """截断代码（在函数/类边界）"""
        lines = content.split("\n")
        truncated_lines = []
        current_length = 0

        for line in lines:
            if current_length + len(line) > max_chars:
                break
            truncated_lines.append(line)
            current_length += len(line) + 1

        # 确保在完整的代码块结束
        result = "\n".join(truncated_lines)
        result += "\n\n# ... [代码已截断]"
        return result, True

    @staticmethod
    def _truncate_markdown(content: str, max_chars: int) -> Tuple[str, bool]:
        """截断Markdown（在标题边界）"""
        truncated = content[:max_chars]

        # 尝试在最近的标题处截断
        header_positions = [m.start() for m in re.finditer(r"\n#{1,3}\s", truncated)]
        if header_positions:
            last_header = header_positions[-1]
            if last_header > max_chars * 0.5:
                truncated = truncated[:last_header]

        return truncated + "\n\n... [内容已截断]", True

    @staticmethod
    def compress_content(content: str, target_ratio: float = 0.5) -> str:
        """压缩长内容（智能摘要）"""
        if len(content) < 1000:
            return content

        sentences = re.split(r'(?<=[。！？.!?])\s*', content)
        if len(sentences) <= 3:
            return content

        # 保留首句、尾句和中间的关键句
        keep_count = max(3, int(len(sentences) * target_ratio))
        if keep_count >= len(sentences):
            return content

        # 简单的关键句选择：包含数字、关键词的句子
        keywords = ["重要", "关键", "首先", "其次", "最后", "总结", "因此", "然而",
                    "important", "key", "first", "second", "finally", "summary",
                    "therefore", "however", "结论", "结果", "数据"]

        scored = []
        for i, sentence in enumerate(sentences):
            score = 0
            if i == 0 or i == len(sentences) - 1:
                score += 10  # 首尾句优先
            if any(kw in sentence for kw in keywords):
                score += 5
            if re.search(r"\d", sentence):
                score += 2
            scored.append((i, score, sentence))

        # 按分数排序，取前keep_count个，然后按原顺序排列
        scored.sort(key=lambda x: x[1], reverse=True)
        selected = sorted(scored[:keep_count], key=lambda x: x[0])

        compressed = "".join(s[2] for s in selected)
        return compressed + f"\n\n[内容已压缩，原文{len(sentences)}句，保留{keep_count}句]"
