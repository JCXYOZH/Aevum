"""输出控制职责：models。"""

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


class OutputFormat(Enum):
    """输出格式"""
    PLAIN_TEXT = "plain_text"
    MARKDOWN = "markdown"
    JSON = "json"
    CODE = "code"
    TABLE = "table"
    LIST = "list"
    XML = "xml"
    YAML = "yaml"
    MIXED = "mixed"

class OutputQuality(Enum):
    """输出质量等级"""
    EXCELLENT = "excellent"
    GOOD = "good"
    ACCEPTABLE = "acceptable"
    POOR = "poor"
    INVALID = "invalid"

@dataclass
class OutputConfig:
    """输出配置"""
    format: OutputFormat = OutputFormat.PLAIN_TEXT
    length_preset: str = "medium"
    max_tokens: int = 1024
    max_chars: int = 4096
    temperature: float = 0.7
    target_sentences: int = 10
    enforce_structure: bool = False
    allow_truncation: bool = True
    auto_retry_on_low_quality: bool = True
    min_quality_score: float = 0.6
    max_retries: int = 2
    language: str = "zh"
    include_metadata: bool = False
    compression_threshold: int = 8000  # 超过此字符数自动压缩
    segment_threshold: int = 16000  # 超过此字符数分段输出

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format.value,
            "length_preset": self.length_preset,
            "max_tokens": self.max_tokens,
            "max_chars": self.max_chars,
            "temperature": self.temperature,
            "target_sentences": self.target_sentences,
            "enforce_structure": self.enforce_structure,
            "allow_truncation": self.allow_truncation,
            "language": self.language,
        }

@dataclass
class OutputResult:
    """输出结果"""
    content: str
    config: OutputConfig
    quality_score: float = 0.0
    quality_level: OutputQuality = OutputQuality.ACCEPTABLE
    format_valid: bool = True
    truncated: bool = False
    compressed: bool = False
    segmented: bool = False
    segments: List[str] = field(default_factory=list)
    retries: int = 0
    processing_time_ms: float = 0.0
    warnings: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "content": self.content,
            "content_length": len(self.content),
            "config": self.config.to_dict(),
            "quality_score": round(self.quality_score, 3),
            "quality_level": self.quality_level.value,
            "format_valid": self.format_valid,
            "truncated": self.truncated,
            "compressed": self.compressed,
            "segmented": self.segmented,
            "segment_count": len(self.segments),
            "retries": self.retries,
            "processing_time_ms": round(self.processing_time_ms, 2),
            "warnings": self.warnings,
        }
