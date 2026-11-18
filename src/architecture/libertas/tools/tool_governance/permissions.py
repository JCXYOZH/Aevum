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

from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK
from .models import PendingApproval, RiskLevel, ToolCallRecord


class GovernancePermissionMixin:
    """AI 风险等级、审批申请与人工审批。"""

    def check_permission(self, tool_name: str, tool_type: str = "native",
                         params: Dict = None, caller_type: str = "ai") -> Dict:
        """检查工具是否允许执行
    
        caller_type:
            ai      受风险等级与审批约束，不设调用频率上限
            human   本机人工操作，跳过风险上限与审批，保留配置开关与审计
        返回：
        {
            "allowed": bool,
            "needs_approval": bool,
            "reason": str,
            "risk_level": str,
            "tool_info": Dict
        }
        """
        if not self._config["enabled"]:
            return {"allowed": True, "needs_approval": False,
                    "reason": "治理已禁用", "risk_level": "safe",
                    "tool_info": self.get_tool_info(tool_name, tool_type)}
    
        info = self.get_tool_info(tool_name, tool_type)
        risk = info["risk"]
        category = info.get("category", "其他")
    
        # 工具类型开关
        enabled_types = self._config.get("enabled_types", {})
        if tool_type in enabled_types and not enabled_types[tool_type]:
            return {"allowed": False, "needs_approval": False,
                    "reason": f"工具类型 {tool_type} 已被禁用",
                    "risk_level": risk, "tool_info": info}
    
        # 类别开关
        enabled_categories = self._config.get("enabled_categories", {})
        if category in enabled_categories and not enabled_categories[category]:
            return {"allowed": False, "needs_approval": False,
                    "reason": f"工具类别「{category}」已被禁用",
                    "risk_level": risk, "tool_info": info}
    
        # 黑名单检查
        if tool_name in self._config["tool_blacklist"]:
            return {"allowed": False, "needs_approval": False,
                    "reason": f"工具 {tool_name} 已被黑名单禁止",
                    "risk_level": risk, "tool_info": info}
    
        # 白名单检查
        wl = self._config["tool_whitelist"]
        if wl and tool_name not in wl:
            return {"allowed": False, "needs_approval": False,
                    "reason": f"工具 {tool_name} 不在白名单中",
                    "risk_level": risk, "tool_info": info}
    
        # 风险级别检查
        if risk in self._config["blocked_risks"]:
            return {"allowed": False, "needs_approval": False,
                    "reason": f"风险级别 {risk} 被禁止",
                    "risk_level": risk, "tool_info": info}
    
        # 是否需要审批：仅 AI 调用需要审批，人工操作由操作者直接确认
        is_human = caller_type == "human"
        needs_approval = False
        if not is_human:
            auto_max = self._risk_level_value(self._config["auto_approve_max_risk"])
            needs_approval = (
                risk in self._config["require_approval_risks"]
                or self._risk_level_value(risk) > auto_max
            )
    
        return {"allowed": True, "needs_approval": needs_approval,
                "reason": "OK", "risk_level": risk, "tool_info": info}

    def request_approval(self, tool_name: str, tool_type: str,
                         params: Dict, target: str = "",
                         description: str = "") -> PendingApproval:
        """创建审批请求"""
        with self._lock:
            info = self.get_tool_info(tool_name, tool_type)
            approval = PendingApproval(
                id=str(uuid.uuid4())[:8],
                tool_name=tool_name,
                tool_type=tool_type,
                risk_level=info["risk"],
                params=params or {},
                target=target,
                created_at=time.time(),
                description=description or f"{info['desc']} → {target or 'N/A'}",
            )
            self._pending[approval.id] = approval
            self._notify_listeners("approval_requested", approval)
            return approval

    def approve(self, approval_id: str) -> bool:
        """批准"""
        with self._lock:
            a = self._pending.get(approval_id)
            if a and not a.resolved:
                a.resolved = True
                a.approved = True
                a.resolved_at = time.time()
                self._notify_listeners("approval_resolved", a)
                return True
            return False

    def deny(self, approval_id: str) -> bool:
        """拒绝"""
        with self._lock:
            a = self._pending.get(approval_id)
            if a and not a.resolved:
                a.resolved = True
                a.approved = False
                a.resolved_at = time.time()
                self._notify_listeners("approval_resolved", a)
                return True
            return False

    def get_pending(self) -> List[Dict]:
        with self._lock:
            return [asdict(a) for a in self._pending.values() if not a.resolved]

    def wait_for_approval(self, approval_id: str, timeout: float = 300.0) -> bool:
        """等待审批结果（阻塞）"""
        start = time.time()
        while time.time() - start < timeout:
            with self._lock:
                a = self._pending.get(approval_id)
                if a and a.resolved:
                    return a.approved
            time.sleep(0.5)
        # 超时视为拒绝
        self.deny(approval_id)
        return False
