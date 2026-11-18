"""平台身份管理器。"""

import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from .models import CreatorApplication, PlatformIdentity, PlatformRole

class PlatformIdentityManager:
    """平台身份与创建者系统"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "platform_identity")
        os.makedirs(self.data_dir, exist_ok=True)
        self._identities: Dict[str, PlatformIdentity] = {}
        self._applications: Dict[str, CreatorApplication] = {}
        self._lock = threading.RLock()
        self._platform_config: Dict[str, Any] = {
            "platform_name": "Libertas Platform",
            "platform_version": "1.0.0",
            "platform_id": "",
            "creator_revenue_share": 0.7,
            "verification_required": True,
            "min_creator_rating": 4.0,
            "founder": "",
            "founder_claimed": False,
            "founder_username": "",
            "engineer_mode": True,
            "description": "Libertas 去中心化AI平台",
            "endpoint": "",
            "engineers": [],
            "created_at": time.time(),
        }
        self._load()
        # 首次启动生成唯一平台ID，生成后持久化，不会因重启丢失
        # 每个实例/分叉有独立平台ID，通过广域网实现多平台互通
        if not self._platform_config.get("platform_id"):
            self._platform_config["platform_id"] = "PLAT-" + secrets.token_hex(6).upper()
            self._save()

    def _load(self):
        id_file = os.path.join(self.data_dir, "identities.json")
        try:
            if os.path.exists(id_file):
                with open(id_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for i_data in data.get("identities", []):
                    identity = PlatformIdentity(
                        username=i_data.get("username", ""),
                        display_name=i_data.get("display_name", ""),
                        role=i_data.get("role", "member"),
                        email=i_data.get("email", ""),
                    )
                    identity.identity_id = i_data.get("identity_id", identity.identity_id)
                    identity.is_verified = i_data.get("is_verified", False)
                    identity.verification_level = i_data.get("verification_level", 0)
                    identity.is_creator = i_data.get("is_creator", False)
                    identity.creator_since = i_data.get("creator_since", 0)
                    identity.total_creations = i_data.get("total_creations", 0)
                    identity.total_revenue = i_data.get("total_revenue", 0)
                    identity.followers = i_data.get("followers", 0)
                    identity.rating = i_data.get("rating", 0)
                    identity.rating_count = i_data.get("rating_count", 0)
                    identity.badges = i_data.get("badges", [])
                    identity.permissions = i_data.get("permissions", [])
                    identity.status = i_data.get("status", "active")
                    self._identities[identity.identity_id] = identity
                self._platform_config.update(data.get("platform_config", {}))
        except Exception as e:
            terminal.warn(f"加载平台身份失败: {e}", "platform_identity")

    def _save(self):
        id_file = os.path.join(self.data_dir, "identities.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "identities": [i.to_dict() for i in self._identities.values()],
                "applications": [a.to_dict() for a in self._applications.values()],
                "platform_config": self._platform_config,
            }
            with open(id_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def create_identity(self, username: str, display_name: str = "",
                        role: str = "member", email: str = "") -> PlatformIdentity:
        # 检查用户名
        for identity in self._identities.values():
            if identity.username == username:
                return identity
        identity = PlatformIdentity(username, display_name, role, email)
        with self._lock:
            self._identities[identity.identity_id] = identity
            self._save()
        terminal.info(f"创建平台身份: {username}", "platform_identity")
        return identity

    def get_identity(self, identity_id: str) -> Optional[PlatformIdentity]:
        return self._identities.get(identity_id)

    def get_by_username(self, username: str) -> Optional[PlatformIdentity]:
        for identity in self._identities.values():
            if identity.username == username:
                return identity
        return None

    def update_identity(self, identity_id: str, **kwargs) -> bool:
        identity = self._identities.get(identity_id)
        if not identity:
            return False
        for k, v in kwargs.items():
            if hasattr(identity, k) and k not in ("identity_id", "created_at"):
                setattr(identity, k, v)
        identity.updated_at = time.time()
        self._save()
        return True

    def delete_identity(self, identity_id: str) -> bool:
        with self._lock:
            if identity_id in self._identities:
                del self._identities[identity_id]
                self._save()
                return True
        return False

    def list_identities(self, role: str = "", creator_only: bool = False,
                        status: str = "") -> List[PlatformIdentity]:
        identities = list(self._identities.values())
        if role:
            identities = [i for i in identities if i.role == role]
        if creator_only:
            identities = [i for i in identities if i.is_creator]
        if status:
            identities = [i for i in identities if i.status == status]
        return sorted(identities, key=lambda i: i.created_at)

    def verify_identity(self, identity_id: str, level: int = 1) -> bool:
        identity = self._identities.get(identity_id)
        if identity:
            identity.is_verified = True
            identity.verification_level = max(identity.verification_level, level)
            identity.updated_at = time.time()
            self._save()
            return True
        return False

    def apply_creator(self, identity_id: str, reason: str = "",
                      portfolio: Optional[List[str]] = None) -> CreatorApplication:
        application = CreatorApplication(identity_id, reason, portfolio)
        with self._lock:
            self._applications[application.application_id] = application
            self._save()
        terminal.info(f"创建者申请: {identity_id}", "platform_identity")
        return application

    def approve_creator(self, application_id: str, reviewer: str = "",
                        notes: str = "") -> bool:
        application = self._applications.get(application_id)
        if not application or application.status != "pending":
            return False
        application.status = "approved"
        application.reviewed_at = time.time()
        application.reviewed_by = reviewer
        application.review_notes = notes
        identity = self._identities.get(application.identity_id)
        if identity:
            identity.is_creator = True
            identity.creator_since = time.time()
            identity.role = "creator"
            identity.badges.append({"name": "创建者", "icon": "[ART]", "earned_at": time.time()})
        self._save()
        terminal.success(f"创建者申请已批准: {application_id}", "platform_identity")
        return True

    def reject_creator(self, application_id: str, reviewer: str = "",
                       reason: str = "") -> bool:
        application = self._applications.get(application_id)
        if not application or application.status != "pending":
            return False
        application.status = "rejected"
        application.reviewed_at = time.time()
        application.reviewed_by = reviewer
        application.rejection_reason = reason
        self._save()
        return False

    def list_applications(self, status: str = "") -> List[CreatorApplication]:
        apps = list(self._applications.values())
        if status:
            apps = [a for a in apps if a.status == status]
        return sorted(apps, key=lambda a: a.created_at, reverse=True)

    def record_creation(self, identity_id: str, revenue: float = 0.0):
        identity = self._identities.get(identity_id)
        if identity:
            identity.total_creations += 1
            identity.total_revenue += revenue * self._platform_config.get("creator_revenue_share", 0.7)
            self._save()

    def rate_creator(self, identity_id: str, rating: float) -> bool:
        identity = self._identities.get(identity_id)
        if identity and 1 <= rating <= 5:
            total_rating = identity.rating * identity.rating_count + rating
            identity.rating_count += 1
            identity.rating = total_rating / identity.rating_count
            self._save()
            return True
        return False

    def suspend_identity(self, identity_id: str, reason: str = "",
                         duration_seconds: float = 0) -> bool:
        identity = self._identities.get(identity_id)
        if identity:
            identity.status = "suspended"
            identity.suspension_reason = reason
            if duration_seconds > 0:
                identity.suspended_until = time.time() + duration_seconds
            self._save()
            return True
        return False

    def unsuspend_identity(self, identity_id: str) -> bool:
        identity = self._identities.get(identity_id)
        if identity:
            identity.status = "active"
            identity.suspended_until = 0
            identity.suspension_reason = ""
            self._save()
            return True
        return False

    def get_platform_config(self) -> Dict[str, Any]:
        return dict(self._platform_config)

    def update_platform_config(self, **kwargs) -> bool:
        self._platform_config.update(kwargs)
        self._save()
        return True

    def get_creator_leaderboard(self, metric: str = "total_creations",
                                limit: int = 20) -> List[Dict[str, Any]]:
        creators = [i for i in self._identities.values() if i.is_creator]
        creators.sort(key=lambda c: getattr(c, metric, 0), reverse=True)
        return [{"rank": i + 1, "username": c.username, "display_name": c.display_name,
                 "total_creations": c.total_creations, "total_revenue": round(c.total_revenue, 2),
                 "followers": c.followers, "rating": round(c.rating, 2)}
                for i, c in enumerate(creators[:limit])]

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._identities)
        creators = sum(1 for i in self._identities.values() if i.is_creator)
        verified = sum(1 for i in self._identities.values() if i.is_verified)
        active = sum(1 for i in self._identities.values() if i.status == "active")
        suspended = sum(1 for i in self._identities.values() if i.status == "suspended")
        total_creations = sum(i.total_creations for i in self._identities.values())
        total_revenue = sum(i.total_revenue for i in self._identities.values())
        pending_apps = sum(1 for a in self._applications.values() if a.status == "pending")
        return {
            "total_identities": total,
            "creators": creators,
            "verified": verified,
            "active": active,
            "suspended": suspended,
            "total_creations": total_creations,
            "total_revenue": round(total_revenue, 2),
            "pending_applications": pending_apps,
            "platform_name": self._platform_config.get("platform_name", ""),
            "creator_revenue_share": self._platform_config.get("creator_revenue_share", 0),
        }

    # ===== 平台信息管理 =====

    def get_info(self) -> Dict[str, Any]:
        """获取平台信息"""
        founder = self._platform_config.get("founder", "")
        return {
            "platform_id": self._platform_config.get("platform_id", ""),
            "name": self._platform_config.get("platform_name", "Libertas Platform"),
            "description": self._platform_config.get("description", ""),
            "endpoint": self._platform_config.get("endpoint", ""),
            "version": self._platform_config.get("platform_version", "1.0.0"),
            "founder": founder,
            "founder_claimed": bool(founder) or self._platform_config.get("founder_claimed", False),
            "founder_username": founder or self._platform_config.get("founder_username", ""),
            "engineer_mode": self._platform_config.get("engineer_mode", True),
            "engineers": self._platform_config.get("engineers", []),
            "creator_revenue_share": self._platform_config.get("creator_revenue_share", 0.7),
            "created_at": self._platform_config.get("created_at", 0),
            "stats": self.get_stats(),
        }

    def update_info(self, name: str = None, description: str = None,
                    endpoint: str = None) -> Dict[str, Any]:
        """更新平台信息（仅创建者可调用）"""
        updated = []
        if name is not None:
            self._platform_config["platform_name"] = name
            updated.append("name")
        if description is not None:
            self._platform_config["description"] = description
            updated.append("description")
        if endpoint is not None:
            self._platform_config["endpoint"] = endpoint
            updated.append("endpoint")
        self._save()
        return {"success": True, "updated": updated, "info": self.get_info()}

    # ===== 角色与权限 =====

    def is_founder(self, username: str) -> bool:
        """检查用户是否为平台创建者"""
        if not username:
            return False
        founder = self._platform_config.get("founder", "")
        if founder and founder == username:
            return True
        # 也检查身份的 role 字段
        identity = self.get_by_username(username)
        if identity and identity.role == "founder":
            return True
        return False

    def has_engineer_role(self, username: str) -> bool:
        """检查用户是否有工程师角色"""
        if not username:
            return False
        engineers = self._platform_config.get("engineers", [])
        if username in engineers:
            return True
        identity = self.get_by_username(username)
        if identity and identity.role in ("engineer", "founder", "admin"):
            return True
        return False

    def claim_founder(self, username: str) -> Dict[str, Any]:
        """认领平台创建者（第一个调用的用户成为创建者，同时获得工程师角色）"""
        if not username:
            return {"success": False, "error": "用户名不能为空"}
        current_founder = self._platform_config.get("founder", "")
        if current_founder:
            return {"success": False, "error": f"平台创建者已被 {current_founder} 认领"}
        self._platform_config["founder"] = username
        self._platform_config["founder_claimed"] = True
        self._platform_config["founder_username"] = username
        # 创建者自动获得工程师角色
        engineers = self._platform_config.get("engineers", [])
        if username not in engineers:
            engineers.append(username)
            self._platform_config["engineers"] = engineers
        # 同时更新该用户的身份 role
        identity = self.get_by_username(username)
        if identity:
            identity.role = "founder"
        else:
            self.create_identity(username, role="founder")
        self._save()
        return {"success": True, "founder": username, "message": f"{username} 已成为平台创建者（含工程师角色）"}

    def get_effective_permissions(self, username: str = "",
                                   governance_role: str = "") -> Dict[str, bool]:
        """获取用户的有效权限"""
        perms = {
            "publish": False,
            "manage_users": False,
            "access_security": False,
            "manage_platform": False,
            "use_tools": True,
            "access_memory": True,
            "access_code": True,
            "access_network": True,
        }
        # 基础用户权限
        if username:
            perms["use_tools"] = True
            perms["access_memory"] = True
            perms["access_code"] = True
            perms["access_network"] = True
        # 工程师权限
        if self.has_engineer_role(username):
            perms["publish"] = True
            perms["access_security"] = True
        # 创建者/管理员权限
        if self.is_founder(username):
            perms["publish"] = True
            perms["manage_users"] = True
            perms["access_security"] = True
            perms["manage_platform"] = True
        # 治理角色叠加
        if governance_role in ("admin", "founder"):
            perms["manage_users"] = True
            perms["manage_platform"] = True
            perms["publish"] = True
        elif governance_role == "engineer":
            perms["publish"] = True
            perms["access_security"] = True
        elif governance_role == "reviewer":
            perms["publish"] = True
        return perms
