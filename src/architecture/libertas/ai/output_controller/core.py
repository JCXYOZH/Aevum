"""输出控制职责：core。"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from .formatting import FormatTemplateEngine
from .length import LengthController
from .models import OutputConfig
from .models import OutputFormat
from .models import OutputQuality
from .models import OutputResult
from .quality import QualityEvaluator

class OutputController:
    """
    AI输出格式与长度控制器

    整合格式模板、长度控制、质量评估、后处理。
    """

    def __init__(self, default_config: Optional[OutputConfig] = None):
        self.default_config = default_config or OutputConfig()
        self.format_engine = FormatTemplateEngine()
        self.length_controller = LengthController()
        self.quality_evaluator = QualityEvaluator()
        self._audit_log: List[Dict] = []
        self._stats = defaultdict(int)

    def process(self, content: str, config: Optional[OutputConfig] = None,
                prompt: str = "") -> OutputResult:
        """
        处理AI输出

        Args:
            content: 原始输出内容
            config: 输出配置（None则使用默认）
            prompt: 原始prompt（用于质量评估）

        Returns:
            OutputResult
        """
        start_time = time.time()
        config = config or self.default_config
        result = OutputResult(content=content, config=config)

        # 1. 格式验证和修复
        if config.enforce_structure:
            content = self._ensure_format(content, config)
            result.content = content

        # 2. 格式有效性检查
        format_valid, format_reason = self.format_engine.validate_format(
            content, config.format
        )
        result.format_valid = format_valid
        if not format_valid:
            result.warnings.append(f"格式验证: {format_reason}")

        # 3. 长度控制（截断）
        if len(content) > config.max_chars and config.allow_truncation:
            content, truncated = self.length_controller.smart_truncate(
                content, config.max_chars, config.format
            )
            result.content = content
            result.truncated = truncated
            if truncated:
                result.warnings.append(f"内容已从{len(content)}截断到{config.max_chars}字符")

        # 4. 长内容压缩
        if len(content) > config.compression_threshold:
            compressed = self.length_controller.compress_content(content, target_ratio=0.5)
            if len(compressed) < len(content):
                result.content = compressed
                result.compressed = True
                result.warnings.append(f"内容已压缩，从{len(content)}到{len(compressed)}字符")

        # 5. 超长内容分段
        if len(result.content) > config.segment_threshold:
            result.segments = self._segment_content(result.content, config.segment_threshold)
            result.segmented = True
            result.warnings.append(f"内容已分为{len(result.segments)}段")

        # 6. 质量评估
        quality_score, quality_level, issues = self.quality_evaluator.evaluate(
            result.content, config, prompt
        )
        result.quality_score = quality_score
        result.quality_level = quality_level
        result.warnings.extend(issues)

        # 7. 元数据
        if config.include_metadata:
            result.metadata = {
                "original_length": len(content),
                "processed_length": len(result.content),
                "estimated_tokens": self.length_controller.estimate_tokens(result.content),
                "detected_format": self.format_engine.detect_format(result.content).value,
                "char_count": len(result.content),
                "line_count": result.content.count("\n") + 1,
                "sentence_count": len(re.split(r'(?<=[。！？.!?])\s*', result.content)),
            }

        result.processing_time_ms = (time.time() - start_time) * 1000

        # 审计
        self._audit(result)
        self._stats["total_processed"] += 1
        if result.truncated:
            self._stats["truncated"] += 1
        if result.compressed:
            self._stats["compressed"] += 1
        if result.quality_level in (OutputQuality.POOR, OutputQuality.INVALID):
            self._stats["low_quality"] += 1

        return result

    def _ensure_format(self, content: str, config: OutputConfig) -> str:
        """确保输出格式正确"""
        if config.format == OutputFormat.JSON:
            # 尝试提取JSON
            json_content = self.format_engine.extract_json(content)
            if json_content:
                return json_content
            # 无法提取，尝试包装
            try:
                return json.dumps({"content": content}, ensure_ascii=False)
            except Exception:
                return content

        return content

    def _segment_content(self, content: str, segment_size: int) -> List[str]:
        """将内容分段"""
        segments = []
        remaining = content
        while len(remaining) > segment_size:
            # 在段落边界分割
            split_point = remaining.rfind("\n\n", 0, segment_size)
            if split_point < segment_size * 0.5:
                split_point = segment_size
            segments.append(remaining[:split_point])
            remaining = remaining[split_point:].lstrip()
        if remaining:
            segments.append(remaining)
        return segments

    def get_system_prompt(self, output_format: Optional[OutputFormat] = None) -> str:
        """获取格式对应的系统提示"""
        fmt = output_format or self.default_config.format
        return self.format_engine.get_system_prompt(fmt)

    def get_config_for_task(self, task_type: str, complexity: str = "medium") -> OutputConfig:
        """根据任务类型获取配置"""
        return self.length_controller.get_config_for_task(task_type, complexity)

    def should_retry(self, result: OutputResult) -> bool:
        """判断是否应该重试生成"""
        if not result.config.auto_retry_on_low_quality:
            return False
        if result.retries >= result.config.max_retries:
            return False
        return result.quality_score < result.config.min_quality_score

    def _audit(self, result: OutputResult):
        """记录审计日志"""
        entry = {
            "timestamp": time.time(),
            "content_length": len(result.content),
            "format": result.config.format.value,
            "quality_score": round(result.quality_score, 3),
            "quality_level": result.quality_level.value,
            "truncated": result.truncated,
            "compressed": result.compressed,
            "segmented": result.segmented,
            "processing_time_ms": round(result.processing_time_ms, 2),
        }
        self._audit_log.append(entry)
        if len(self._audit_log) > 1000:
            self._audit_log = self._audit_log[-1000:]

    def get_audit_log(self, limit: int = 100) -> List[Dict]:
        return self._audit_log[-limit:]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_processed": self._stats.get("total_processed", 0),
            "truncated": self._stats.get("truncated", 0),
            "compressed": self._stats.get("compressed", 0),
            "low_quality": self._stats.get("low_quality", 0),
            "default_config": self.default_config.to_dict(),
        }
