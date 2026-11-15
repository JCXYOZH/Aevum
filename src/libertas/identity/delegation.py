"""
core/delegation.py - 权限委托

支持委托人→受托人的权限范围、时间窗口、可撤销委托链、审批流程、审计。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 委托状态
# ================================================================
class DelegationStatus(Enum):
    PENDING = "pending"
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    REJECTED = "rejected"


# ================================================================
# 委托对象
# ================================================================
class Delegation:
    """权限委托"""

    def __init__(self, delegator: str = "", delegatee: str = "",
                 permissions: Optional[List[str]] = None,
                 resources: Optional[List[str]] = None,
                 actions: Optional[List[str]] = None,
                 start_time: float = 0.0, end_time: float = 0.0,
                 max_chain_depth: int = 1, requires_approval: bool = False,
                 reason: str = ""):
        self.delegation_id = f"del_{uuid.uuid4().hex[:8]}"
        self.delegator = delegator
        self.delegatee = delegatee
        self.permissions = permissions or []
        self.resources = resources or ["*"]
        self.actions = actions or ["*"]
        self.start_time = start_time or time.time()
        self.end_time = end_time or (self.start_time + 86400)  # 默认24小时
        self.max_chain_depth = max_chain_depth
        self.requires_approval = requires_approval
        self.reason = reason
        self.status = DelegationStatus.PENDING if requires_approval else DelegationStatus.ACTIVE
        self.parent_delegation = ""
        self.chain_depth = 0
        self.created_at = time.time()
        self.updated_at = time.time()
        self.approved_by = ""
        self.approved_at = 0.0
        self.revoked_by = ""
        self.revoked_at = 0.0
        self.revocation_reason = ""
        self.usage_count = 0
        self.last_used = 0.0

    def is_active(self) -> bool:
        if self.status != DelegationStatus.ACTIVE:
            return False
        now = time.time()
        return self.start_time <= now <= self.end_time

    def can_perform(self, action: str, resource: str) -> bool:
        if not self.is_active():
            return False
        if "*" not in self.actions and action not in self.actions:
            return False
        if "*" not in self.resources and resource not in self.resources:
            return False
        return True

    def can_delegate(self) -> bool:
        return self.is_active() and self.chain_depth < self.max_chain_depth

    def record_usage(self):
        self.usage_count += 1
        self.last_used = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "delegation_id": self.delegation_id,
            "delegator": self.delegator, "delegatee": self.delegatee,
            "permissions": self.permissions, "resources": self.resources,
            "actions": self.actions,
            "start_time": self.start_time, "end_time": self.end_time,
            "start_time_str": datetime.fromtimestamp(self.start_time).strftime("%Y-%m-%d %H:%M:%S"),
            "end_time_str": datetime.fromtimestamp(self.end_time).strftime("%Y-%m-%d %H:%M:%S"),
            "max_chain_depth": self.max_chain_depth,
            "requires_approval": self.requires_approval,
            "reason": self.reason, "status": self.status.value,
            "parent_delegation": self.parent_delegation,
            "chain_depth": self.chain_depth,
            "created_at": self.created_at, "updated_at": self.updated_at,
            "approved_by": self.approved_by, "approved_at": self.approved_at,
            "revoked_by": self.revoked_by, "revoked_at": self.revoked_at,
            "revocation_reason": self.revocation_reason,
            "usage_count": self.usage_count, "last_used": self.last_used,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Delegation":
        d = cls(delegator=data.get("delegator", ""), delegatee=data.get("delegatee", ""))
        for k, v in data.items():
            if hasattr(d, k):
                if k == "status":
                    d.status = DelegationStatus(v)
                else:
                    setattr(d, k, v)
        return d


# ================================================================
# 权限委托管理器
# ================================================================
class DelegationManager:
    """权限委托管理器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "delegations")
        os.makedirs(self.data_dir, exist_ok=True)
        self._delegations: Dict[str, Delegation] = {}
        self._approval_callbacks: List[Any] = []
        self._lock = threading.RLock()
        self._load()

    def _load(self):
        index_file = os.path.join(self.data_dir, "delegations.json")
        try:
            if os.path.exists(index_file):
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for d_data in data.get("delegations", []):
                    d = Delegation.from_dict(d_data)
                    self._delegations[d.delegation_id] = d
        except Exception as e:
            terminal.warn(f"加载委托记录失败: {e}", "delegation")

    def _save(self):
        index_file = os.path.join(self.data_dir, "delegations.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "delegations": [d.to_dict() for d in self._delegations.values()],
            }
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"保存委托记录失败: {e}", "delegation")

    def create_delegation(self, delegator: str, delegatee: str,
                          permissions: Optional[List[str]] = None,
                          resources: Optional[List[str]] = None,
                          actions: Optional[List[str]] = None,
                          duration_seconds: float = 86400,
                          requires_approval: bool = False,
                          reason: str = "",
                          parent_delegation_id: str = "") -> Delegation:
        """创建委托"""
        now = time.time()
        d = Delegation(
            delegator=delegator, delegatee=delegatee,
            permissions=permissions, resources=resources, actions=actions,
            start_time=now, end_time=now + duration_seconds,
            requires_approval=requires_approval, reason=reason,
        )

        if parent_delegation_id and parent_delegation_id in self._delegations:
            parent = self._delegations[parent_delegation_id]
            if not parent.can_delegate():
                raise ValueError("父委托不允许再委托或已达最大链深度")
            d.parent_delegation = parent_delegation_id
            d.chain_depth = parent.chain_depth + 1
            d.max_chain_depth = parent.max_chain_depth
            # 子委托权限不能超过父委托
            if parent.resources != ["*"]:
                d.resources = [r for r in (resources or []) if r in parent.resources or r == "*"]
            if parent.actions != ["*"]:
                d.actions = [a for a in (actions or []) if a in parent.actions or a == "*"]

        with self._lock:
            self._delegations[d.delegation_id] = d
            self._save()

        if requires_approval:
            terminal.info(f"创建待审批委托: {delegator} -> {delegatee}", "delegation")
            for cb in self._approval_callbacks:
                try:
                    cb(d)
                except Exception:
                    pass
        else:
            terminal.info(f"创建委托: {delegator} -> {delegatee} ({duration_seconds}s)", "delegation")

        return d

    def approve_delegation(self, delegation_id: str, approver: str) -> bool:
        """审批通过委托"""
        d = self._delegations.get(delegation_id)
        if not d or d.status != DelegationStatus.PENDING:
            return False
        d.status = DelegationStatus.ACTIVE
        d.approved_by = approver
        d.approved_at = time.time()
        d.updated_at = time.time()
        self._save()
        terminal.info(f"委托已批准: {delegation_id} by {approver}", "delegation")
        return True

    def reject_delegation(self, delegation_id: str, rejecter: str, reason: str = "") -> bool:
        """拒绝委托"""
        d = self._delegations.get(delegation_id)
        if not d or d.status != DelegationStatus.PENDING:
            return False
        d.status = DelegationStatus.REJECTED
        d.revocation_reason = reason
        d.updated_at = time.time()
        self._save()
        return True

    def revoke_delegation(self, delegation_id: str, revoker: str, reason: str = "") -> bool:
        """撤销委托"""
        d = self._delegations.get(delegation_id)
        if not d or d.status != DelegationStatus.ACTIVE:
            return False
        d.status = DelegationStatus.REVOKED
        d.revoked_by = revoker
        d.revoked_at = time.time()
        d.revocation_reason = reason
        d.updated_at = time.time()
        # 撤销所有子委托
        for child in self._delegations.values():
            if child.parent_delegation == delegation_id and child.status == DelegationStatus.ACTIVE:
                child.status = DelegationStatus.REVOKED
                child.revoked_by = revoker
                child.revoked_at = time.time()
                child.revocation_reason = f"父委托被撤销: {reason}"
        self._save()
        terminal.info(f"委托已撤销: {delegation_id} by {revoker}", "delegation")
        return True

    def check_permission(self, delegatee: str, action: str, resource: str) -> Tuple[bool, Optional[Delegation]]:
        """检查受托人是否有权执行操作"""
        now = time.time()
        for d in self._delegations.values():
            if d.delegatee == delegatee and d.can_perform(action, resource):
                d.record_usage()
                return True, d
        return False, None

    def get_delegation(self, delegation_id: str) -> Optional[Delegation]:
        return self._delegations.get(delegation_id)

    def list_delegations(self, delegator: str = "", delegatee: str = "",
                         status: str = "", resource: str = "") -> List[Delegation]:
        with self._lock:
            delegations = list(self._delegations.values())
        if delegator:
            delegations = [d for d in delegations if d.delegator == delegator]
        if delegatee:
            delegations = [d for d in delegations if d.delegatee == delegatee]
        if status:
            delegations = [d for d in delegations if d.status.value == status]
        if resource:
            delegations = [d for d in delegations if resource in d.resources or "*" in d.resources]
        return sorted(delegations, key=lambda d: d.created_at, reverse=True)

    def get_active_delegations(self, delegatee: str = "") -> List[Delegation]:
        return [d for d in self.list_delegations(delegatee=delegatee) if d.is_active()]

    def get_delegation_chain(self, delegation_id: str) -> List[Delegation]:
        """获取委托链"""
        chain = []
        current = self._delegations.get(delegation_id)
        while current:
            chain.append(current)
            if current.parent_delegation:
                current = self._delegations.get(current.parent_delegation)
            else:
                break
        return list(reversed(chain))

    def cleanup_expired(self) -> int:
        """清理过期委托"""
        now = time.time()
        count = 0
        for d in self._delegations.values():
            if d.status == DelegationStatus.ACTIVE and d.end_time < now:
                d.status = DelegationStatus.EXPIRED
                d.updated_at = now
                count += 1
        if count > 0:
            self._save()
            terminal.info(f"清理过期委托: {count} 个", "delegation")
        return count

    def on_approval_requested(self, callback):
        self._approval_callbacks.append(callback)

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._delegations)
        by_status = {}
        for d in self._delegations.values():
            by_status[d.status.value] = by_status.get(d.status.value, 0) + 1
        return {
            "total": total,
            "by_status": by_status,
            "active": sum(1 for d in self._delegations.values() if d.is_active()),
            "pending_approval": sum(1 for d in self._delegations.values() if d.status == DelegationStatus.PENDING),
            "total_usage": sum(d.usage_count for d in self._delegations.values()),
        }


# 全局委托管理器
_delegation_manager = DelegationManager()


def get_delegation_manager() -> DelegationManager:
    return _delegation_manager


def delegate_permission(**kwargs) -> Delegation:
    return _delegation_manager.create_delegation(**kwargs)
