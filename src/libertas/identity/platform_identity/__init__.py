"""平台身份入口。"""

from .models import PlatformRole, PlatformIdentity, CreatorApplication
from .manager import PlatformIdentityManager
from .singleton import (
    _platform_identity_manager, get_platform_identity_manager,
    create_platform_identity, auto_claim_founder_if_needed,
)

__all__ = [
    "PlatformRole", "PlatformIdentity", "CreatorApplication",
    "PlatformIdentityManager", "_platform_identity_manager",
    "get_platform_identity_manager", "create_platform_identity",
    "auto_claim_founder_if_needed",
]
