"""平台身份管理器单例与模块级入口。"""

from .manager import PlatformIdentityManager
from .models import CreatorApplication, PlatformIdentity, PlatformRole

_platform_identity_manager = PlatformIdentityManager()

def get_platform_identity_manager() -> PlatformIdentityManager:
    return _platform_identity_manager

def create_platform_identity(username: str, **kwargs) -> PlatformIdentity:
    return _platform_identity_manager.create_identity(username, **kwargs)

def auto_claim_founder_if_needed(user_id: str):
    pass
