"""WAF/IDS/IPS 集中防护引擎 - 统一入口，整合指纹识别、载荷分析、沙箱测试、流量监控。

防护模式：
- off: 关闭
- detect: 仅检测记录（默认）
- alert: 检测+告警
- protect: 检测+告警+阻断（IPS模式）
"""

import time
import json
import threading
import logging
from typing import Dict, List, Optional, Any
from collections import deque

from libertas.security.legacy_mrhua.waf_fingerprint import detect_waf, is_blocked_by_waf
from libertas.security.legacy_mrhua.payload_analyzer import analyze_request, analyze_response, PAYLOAD_CATEGORIES
from libertas.security.legacy_mrhua.waf_sandbox import get_waf_sandbox
from libertas.security.legacy_mrhua.traffic_monitor import get_traffic_detector
from .constants import *  # noqa: F401,F403

class SecurityEngineBase:
    """WAF/IDS/IPS 集中防护引擎。"""

    MODE_OFF = "off"
    MODE_DETECT = "detect"
    MODE_ALERT = "alert"
    MODE_PROTECT = "protect"
