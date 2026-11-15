"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .audit import GovernanceAuditMixin
from .catalog import GovernanceCatalogMixin
from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .config import GovernanceConfigMixin
from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK
from .errors import GovernanceErrorMixin
from .models import PendingApproval, RiskLevel, ToolCallRecord
from .permissions import GovernancePermissionMixin


class ToolGovernance(GovernanceConfigMixin, GovernanceCatalogMixin, GovernancePermissionMixin, GovernanceAuditMixin, GovernanceErrorMixin):
    """工具治理器：权限、审批、审计与错误回退。"""

    def __init__(self, data_dir: str = None):
        self._lock = threading.RLock()
        self._audit_log: List[ToolCallRecord] = []
        self._pending: Dict[str, PendingApproval] = {}
        self._listeners: List[Callable] = []
    
        # 数据目录
        if data_dir is None:
            # 用统一的 get_data_dir()：它会读 LIBERTAS_DATA_DIR / 非系统盘等配置。
            # 写死 ~/LibertasData 会导致「换了数据目录，工具治理配置还留在老地方」，
            # 测试/多实例场景下还会互相串味。
            try:
                from libertas.foundation.config import get_data_dir as _get_data_dir
                data_dir = _get_data_dir()
            except Exception:
                data_dir = os.path.join(os.path.expanduser("~"), "LibertasData")
        self._data_dir = data_dir
        self._audit_dir = os.path.join(data_dir, "audit")
        os.makedirs(self._audit_dir, exist_ok=True)
        self._audit_file = os.path.join(self._audit_dir, "tool_calls.jsonl")
    
        # 权限配置
        self._config = {
            # 全局开关
            "enabled": True,
            # 自动执行的最高风险级别（低于等于此级别自动执行）
            # 默认 high：这是本地安全工具箱，扫描/检测/漏洞验证就是它的主职。
            # 以前默认 safe 的后果是：模型一旦调用中危工具就进入 300 秒审批等待，
            # 对话里没人点确认 → 工具"有但不用/一用就卡"。
            # 需要收紧时改 config.yaml 的 tool_governance.auto_approve_max_risk。
            "auto_approve_max_risk": RiskLevel.HIGH,
            # 模型"可选择"的最高风险级别：只决定工具是否出现在交给模型的工具表里，
            # 不代表可以免授权执行（是否需审批仍由 auto_approve_max_risk 决定）。
            # 默认 high —— 让模型能看到并使用工具体系里的绝大多数工具。
            "model_visible_max_risk": RiskLevel.HIGH,
            # 需要用户确认的风险级别
            # 只把"破坏性"级留在审批里；扫描/检测/漏洞验证不再逐次打断。
            "require_approval_risks": [RiskLevel.DANGEROUS],
            # 禁止的风险级别
            "blocked_risks": [],
            # 工具白名单（空=不限制）
            "tool_whitelist": [],
            # 工具黑名单
            "tool_blacklist": [],
            # 类别开关（按类别启用/禁用）
            "enabled_categories": {
                "信息收集": True,
                "扫描爆破": True,
                "编码解码": True,
                "网络工具": True,
                "外部工具": True,
                "插件工具": True,
                "字典资源": True,
                "工具管理": True,
            },
            # 工具类型开关
            "enabled_types": {
                "web": True,        # 搜索/抓取/链接检查
                "native": True,     # 原生安全工具
                "external": True,   # 外部工具(nmap等)
                "plugin": True,     # 内置插件
                "wordlist": True,   # 字典使用
                "installable": True,   # 可安装工具也暴露给模型（安装动作本身另有确认）
            },
            # 模型是否可以调用工具（总开关）
            "model_can_call_tools": True,
            # 模型调用工具时是否显示状态
            "show_tool_status": True,
            # 审计日志中是否记录参数
            "log_params": True,
            # 审批等待秒数：0 表示不阻塞（立即把"待确认"回给模型，让它继续别的步骤）。
            # 以前硬编码 300 秒，对话里会直接卡死 5 分钟。
            "approval_wait_seconds": 8,
            # 错误回退策略
            "fallback_strategy": "retry_then_alternate",  # retry_then_alternate / skip / abort
            "max_retries": 2,
            # 审计
            "audit_enabled": True,
            "audit_retention_days": 30,
        }
    
        self._load_config()
        # 最后应用 config.yaml：配置文件是「运维显式意图」，必须压过数据目录里
        # 可能残留的旧 tool_governance.json（否则改了配置却像没生效）。
        self._apply_yaml_overrides()

    def _risk_level_value(self, risk: str) -> int:
        order = {RiskLevel.SAFE.value: 0, RiskLevel.LOW.value: 1,
                 RiskLevel.MEDIUM.value: 2, RiskLevel.HIGH.value: 3,
                 RiskLevel.DANGEROUS.value: 4}
        risk = str(risk or "").strip().lower().replace("_risk", "")
        return order.get(risk, 2)

    def add_listener(self, callback: Callable):
        self._listeners.append(callback)

    def remove_listener(self, callback: Callable):
        if callback in self._listeners:
            self._listeners.remove(callback)

    def _notify_listeners(self, event: str, data: Any):
        for cb in self._listeners:
            try:
                cb(event, data)
            except Exception:
                pass
