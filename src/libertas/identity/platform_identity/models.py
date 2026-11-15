"""平台身份、角色与创建者申请模型。"""

import time
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

class PlatformRole(Enum):
    CREATOR = "creator"
    ADMIN = "admin"
    MODERATOR = "moderator"
    MEMBER = "member"
    GUEST = "guest"

class PlatformIdentity:
    """平台身份"""

    def __init__(self, username: str = "", display_name: str = "",
                 role: str = "member", email: str = ""):
        self.identity_id = f"pid_{uuid.uuid4().hex[:8]}"
        self.username = username
        self.display_name = display_name or username
        self.role = role
        self.email = email
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_login = 0.0
        self.login_count = 0
        self.is_verified = False
        self.verification_level = 0  # 0-3
        self.bio = ""
        self.avatar_url = ""
        self.website = ""
        self.social_links: Dict[str, str] = {}
        self.preferences: Dict[str, Any] = {}
        self.notification_settings: Dict[str, bool] = {}
        self.is_creator = False
        self.creator_since = 0.0
        self.total_creations = 0
        self.total_revenue = 0.0
        self.followers = 0
        self.following = 0
        self.rating = 0.0
        self.rating_count = 0
        self.badges: List[Dict[str, Any]] = []
        self.permissions: List[str] = []
        self.api_keys: List[Dict[str, Any]] = []
        self.status = "active"  # active / suspended / banned
        self.suspended_until = 0.0
        self.suspension_reason = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "identity_id": self.identity_id,
            "username": self.username,
            "display_name": self.display_name,
            "role": self.role,
            "email": self.email,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "last_login": self.last_login,
            "login_count": self.login_count,
            "is_verified": self.is_verified,
            "verification_level": self.verification_level,
            "bio": self.bio,
            "is_creator": self.is_creator,
            "creator_since": self.creator_since,
            "total_creations": self.total_creations,
            "total_revenue": round(self.total_revenue, 2),
            "followers": self.followers,
            "rating": round(self.rating, 2),
            "rating_count": self.rating_count,
            "badges": self.badges,
            "permissions": self.permissions,
            "status": self.status,
        }

class CreatorApplication:
    """创建者申请"""

    def __init__(self, identity_id: str = "", reason: str = "",
                 portfolio: Optional[List[str]] = None):
        self.application_id = f"app_{uuid.uuid4().hex[:8]}"
        self.identity_id = identity_id
        self.reason = reason
        self.portfolio = portfolio or []
        self.status = "pending"  # pending / approved / rejected
        self.created_at = time.time()
        self.reviewed_at = 0.0
        self.reviewed_by = ""
        self.review_notes = ""
        self.rejection_reason = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "application_id": self.application_id,
            "identity_id": self.identity_id,
            "reason": self.reason,
            "portfolio": self.portfolio,
            "status": self.status,
            "created_at": self.created_at,
            "reviewed_at": self.reviewed_at,
            "reviewed_by": self.reviewed_by,
            "review_notes": self.review_notes,
        }
