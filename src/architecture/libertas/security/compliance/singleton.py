"""
合规与服从控制系统（优化版）

融合两个版本的功能：
1. 规则守护系统（内容安全检查 + 违规记录）
2. 服从控制引擎（AI拒绝检测 + 强制服从）

职责：
- 规则管理（添加/删除/启用/禁用规则）
- 文本检查（模式匹配/阈值/速率）
- 违规记录和处理
- AI拒绝检测（中英文拒绝模式 + 推脱回避模式）
- 强制执行指令生成（3级递增）
- 系统提示词增强（前缀/后缀/强制模式）
- 输出后处理（清理拒绝前缀）
- 合规报告生成
- SQLite 持久化（compliance.db，rules + violations 两张表）
"""
import os
import re
import time
import json
import secrets
import sqlite3
import threading
from typing import Dict, List, Any, Optional, Tuple, Callable
from enum import Enum
from collections import defaultdict

from .core import ComplianceSystem
from .models import Violation

_compliance_system = None


def get_compliance_system() -> ComplianceSystem:
    """获取合规系统单例"""
    global _compliance_system_instance
    if _compliance_system_instance is None:
        with _compliance_lock:
            if _compliance_system_instance is None:
                _compliance_system_instance = ComplianceSystem()
    return _compliance_system_instance


def guard_text(text: str, **kwargs) -> Tuple[bool, List[Violation], str]:
    """便捷函数：检查文本"""
    return get_compliance_system().check_text(text, **kwargs)
