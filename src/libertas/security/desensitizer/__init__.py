"""数据脱敏入口。"""

from .rules import DesensitizationRule, _build_default_rules
from .generator import FakeDataGenerator
from .core import Desensitizer
from .singleton import _desensitizer, get_desensitizer, desensitize, desensitize_dict, detect_sensitive

__all__ = [
    "DesensitizationRule", "_build_default_rules", "FakeDataGenerator",
    "Desensitizer", "_desensitizer", "get_desensitizer", "desensitize",
    "desensitize_dict", "detect_sensitive",
]
