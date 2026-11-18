"""
security/security_expansion.py - 安全模块综合扩展

高级安全功能：威胁情报中心、攻击链分析器、漏洞利用模拟器、
安全事件响应引擎、入侵检测规则引擎、安全合规检查器、
蜜罐管理系统、安全评分卡系统。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 威胁等级
# ================================================================
from .threat_level import *  # noqa: F401,F403
from .attack_chain_analyzer import *  # noqa: F401,F403
from .ids_rule_engine import *  # noqa: F401,F403
from .incident_response_engine import *  # noqa: F401,F403

_ids_rule_engine = IDSRuleEngine()

_incident_response_engine = IncidentResponseEngine()

_security_scorecard = SecurityScorecard()

def get_threat_intel_center() -> ThreatIntelCenter:
    return _threat_intel_center

def get_attack_chain_analyzer() -> AttackChainAnalyzer:
    return _attack_chain_analyzer

def get_ids_rule_engine() -> IDSRuleEngine:
    return _ids_rule_engine

def get_incident_response_engine() -> IncidentResponseEngine:
    return _incident_response_engine

def get_security_scorecard() -> SecurityScorecard:
    return _security_scorecard
