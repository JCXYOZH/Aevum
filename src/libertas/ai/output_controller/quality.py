"""输出控制职责：quality。"""

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

from .formatting import FormatTemplateEngine
from .models import OutputConfig
from .models import OutputFormat
from .models import OutputQuality

class QualityEvaluator:
    """输出质量评估器"""

    @staticmethod
    def evaluate(content: str, config: OutputConfig,
                 prompt: str = "") -> Tuple[float, OutputQuality, List[str]]:
        """
        评估输出质量

        Returns:
            (质量分数0-1, 质量等级, 问题列表)
        """
        scores = {}
        issues = []

        # 1. 长度合规性 (20分)
        length_score = QualityEvaluator._score_length(content, config)
        scores["length"] = length_score

        # 2. 格式正确性 (25分)
        format_score, format_issues = QualityEvaluator._score_format(content, config)
        scores["format"] = format_score
        issues.extend(format_issues)

        # 3. 内容完整性 (20分)
        completeness_score, completeness_issues = QualityEvaluator._score_completeness(content, prompt)
        scores["completeness"] = completeness_score
        issues.extend(completeness_issues)

        # 4. 连贯性 (15分)
        coherence_score = QualityEvaluator._score_coherence(content)
        scores["coherence"] = coherence_score

        # 5. 相关性 (10分)
        relevance_score = QualityEvaluator._score_relevance(content, prompt)
        scores["relevance"] = relevance_score

        # 6. 无冗余 (10分)
        redundancy_score = QualityEvaluator._score_redundancy(content)
        scores["redundancy"] = redundancy_score

        # 加权总分
        weights = {"length": 0.20, "format": 0.25, "completeness": 0.20,
                   "coherence": 0.15, "relevance": 0.10, "redundancy": 0.10}
        total_score = sum(scores[k] * weights[k] for k in scores)

        # 质量等级
        if total_score >= 0.85:
            quality = OutputQuality.EXCELLENT
        elif total_score >= 0.70:
            quality = OutputQuality.GOOD
        elif total_score >= 0.50:
            quality = OutputQuality.ACCEPTABLE
        elif total_score >= 0.30:
            quality = OutputQuality.POOR
        else:
            quality = OutputQuality.INVALID

        return total_score, quality, issues

    @staticmethod
    def _score_length(content: str, config: OutputConfig) -> float:
        """长度合规性评分"""
        char_count = len(content)
        if char_count == 0:
            return 0.0

        # 目标范围：max_chars的50%-100%
        target_min = config.max_chars * 0.3
        target_max = config.max_chars * 1.2

        if target_min <= char_count <= target_max:
            return 1.0
        elif char_count < target_min:
            return max(0.0, char_count / target_min)
        else:
            return max(0.0, 1.0 - (char_count - target_max) / target_max * 0.5)

    @staticmethod
    def _score_format(content: str, config: OutputConfig) -> Tuple[float, List[str]]:
        """格式正确性评分"""
        issues = []
        if config.format == OutputFormat.PLAIN_TEXT:
            return 1.0, issues

        valid, reason = FormatTemplateEngine.validate_format(content, config.format)
        if valid:
            return 1.0, issues
        else:
            issues.append(f"格式验证失败: {reason}")
            return 0.3, issues

    @staticmethod
    def _score_completeness(content: str, prompt: str) -> Tuple[float, List[str]]:
        """内容完整性评分"""
        issues = []
        if len(content.strip()) < 10:
            issues.append("内容过短")
            return 0.1, issues

        # 检查是否有明显的未完成标记
        incomplete_markers = ["...", "等等", "等等。", "to be continued", "未完待续"]
        if content.rstrip().endswith(tuple(incomplete_markers)):
            issues.append("内容似乎未完成")
            return 0.5, issues

        # 检查是否回答了问题（简单启发式）
        if prompt and len(prompt) > 10:
            # 如果prompt包含问题词，检查content是否有回答结构
            question_words = ["什么", "怎么", "如何", "为什么", "哪", "是否", "能不能",
                             "what", "how", "why", "which", "is", "can", "could"]
            if any(qw in prompt.lower() for qw in question_words):
                if len(content) < 50:
                    issues.append("回答可能不够详细")
                    return 0.6, issues

        return 0.9, issues

    @staticmethod
    def _score_coherence(content: str) -> float:
        """连贯性评分"""
        sentences = re.split(r'(?<=[。！？.!?])\s*', content)
        if len(sentences) <= 1:
            return 0.5

        # 检查句子长度变化（过于均匀可能是模板，过于变化可能不连贯）
        lengths = [len(s) for s in sentences if s.strip()]
        if not lengths:
            return 0.3

        avg_length = sum(lengths) / len(lengths)
        if avg_length == 0:
            return 0.3

        variance = sum((l - avg_length) ** 2 for l in lengths) / len(lengths)
        cv = (variance ** 0.5) / avg_length if avg_length > 0 else 0

        # 变异系数在0.3-1.0之间为正常
        if 0.2 <= cv <= 1.2:
            return 0.9
        elif cv < 0.2:
            return 0.7  # 过于均匀
        else:
            return 0.6  # 变化过大

    @staticmethod
    def _score_relevance(content: str, prompt: str) -> float:
        """相关性评分（简单词频重叠）"""
        if not prompt or len(prompt) < 5:
            return 0.8  # 无prompt时默认中等

        # 提取关键词（简单的非停用词）
        stop_words = set("的了是在我有和就不人都一上也很到说要去你会着没有看好自己这那他她它们什么怎么为什么哪吗呢吧啊哦嗯的话这个那个一些一样".split())
        prompt_words = set(re.findall(r'[\u4e00-\u9fff]{2,}', prompt)) - stop_words
        content_words = set(re.findall(r'[\u4e00-\u9fff]{2,}', content)) - stop_words

        if not prompt_words:
            return 0.7

        overlap = len(prompt_words & content_words)
        ratio = overlap / len(prompt_words)
        return min(1.0, ratio * 1.5)  # 50%重叠即满分

    @staticmethod
    def _score_redundancy(content: str) -> float:
        """无冗余评分"""
        sentences = re.split(r'(?<=[。！？.!?])\s*', content)
        if len(sentences) <= 2:
            return 1.0

        # 检查重复句子
        seen = set()
        duplicates = 0
        for s in sentences:
            normalized = re.sub(r'\s+', '', s.strip())
            if len(normalized) > 10:
                if normalized in seen:
                    duplicates += 1
                seen.add(normalized)

        if duplicates == 0:
            return 1.0
        redundancy_ratio = duplicates / len(sentences)
        return max(0.0, 1.0 - redundancy_ratio * 2)
