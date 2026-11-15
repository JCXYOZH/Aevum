"""职责模块：permissions。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import threading
import time
import uuid

class ToolPermissionManager:
    """工具权限管理器 - 权限分级、白名单、执行确认"""

    def __init__(self, default_max_risk: str = "low_risk"):
        self.manager_id = f"perm_{uuid.uuid4().hex[:8]}"
        self.default_max_risk = default_max_risk
        self.whitelist: set = set()
        self.blacklist: set = set()
        self.user_permissions: Dict[str, str] = {}
        self.pending_confirmations: Dict[str, Dict] = {}
        self._lock = threading.RLock()
        self.risk_order = ["read_only", "low_risk", "medium_risk", "high_risk", "destructive"]

    def can_execute(self, tool_name: str, risk_level: str = "",
                     user: str = "default", caller_type: str = "ai") -> Tuple[bool, str]:
        """检查是否可以执行工具

        caller_type=human 时跳过用户风险等级上限，保留黑白名单。
        """
        # 黑名单优先
        if tool_name in self.blacklist:
            return False, f"工具 {tool_name} 在黑名单中"
        # 白名单直接放行
        if tool_name in self.whitelist:
            return True, ""
        if caller_type == "human":
            return True, ""
        # 用户权限
        max_risk = self.user_permissions.get(user, self.default_max_risk)
        if risk_level and risk_level in self.risk_order:
            user_level = self.risk_order.index(max_risk)
            tool_level = self.risk_order.index(risk_level)
            if tool_level > user_level:
                return False, f"用户 {user} 权限不足（最大风险等级: {max_risk}，工具需要: {risk_level}）"
        return True, ""

    def requires_confirmation(self, tool_name: str, risk_level: str = "",
                              caller_type: str = "ai") -> bool:
        """检查是否需要确认；人工操作直接视为已确认。"""
        if caller_type == "human":
            return False
        if tool_name in self.whitelist:
            return False
        high_risk_levels = ["high_risk", "destructive"]
        return risk_level in high_risk_levels

    def request_confirmation(self, tool_name: str, parameters: Dict,
                             risk_level: str = "", user: str = "default") -> str:
        """请求执行确认"""
        confirm_id = f"confirm_{uuid.uuid4().hex[:6]}"
        self.pending_confirmations[confirm_id] = {
            "tool_name": tool_name,
            "parameters": parameters,
            "risk_level": risk_level,
            "user": user,
            "requested_at": time.time(),
            "status": "pending",
        }
        return confirm_id

    def approve(self, confirm_id: str, approver: str = "") -> bool:
        """批准执行"""
        with self._lock:
            if confirm_id in self.pending_confirmations:
                self.pending_confirmations[confirm_id]["status"] = "approved"
                self.pending_confirmations[confirm_id]["approved_by"] = approver
                self.pending_confirmations[confirm_id]["approved_at"] = time.time()
                return True
        return False

    def deny(self, confirm_id: str, reason: str = "") -> bool:
        """拒绝执行"""
        with self._lock:
            if confirm_id in self.pending_confirmations:
                self.pending_confirmations[confirm_id]["status"] = "denied"
                self.pending_confirmations[confirm_id]["deny_reason"] = reason
                self.pending_confirmations[confirm_id]["denied_at"] = time.time()
                return True
        return False

    def get_confirmation_status(self, confirm_id: str) -> Optional[Dict]:
        return self.pending_confirmations.get(confirm_id)

    def add_to_whitelist(self, tool_name: str):
        self.whitelist.add(tool_name)

    def remove_from_whitelist(self, tool_name: str) -> bool:
        return self.whitelist.discard(tool_name)

    def add_to_blacklist(self, tool_name: str):
        self.blacklist.add(tool_name)

    def remove_from_blacklist(self, tool_name: str) -> bool:
        return self.blacklist.discard(tool_name)

    def set_user_permission(self, user: str, max_risk: str):
        self.user_permissions[user] = max_risk

    def get_pending_confirmations(self) -> List[Dict]:
        return [c for c in self.pending_confirmations.values() if c["status"] == "pending"]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "manager_id": self.manager_id,
            "default_max_risk": self.default_max_risk,
            "whitelist_count": len(self.whitelist),
            "blacklist_count": len(self.blacklist),
            "users_with_permissions": len(self.user_permissions),
            "pending_confirmations": len(self.get_pending_confirmations()),
            "total_confirmations": len(self.pending_confirmations),
        }
