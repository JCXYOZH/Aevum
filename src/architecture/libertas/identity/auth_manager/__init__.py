"""统一认证与授权公共入口。"""

from .constants import LICENSE_SECRET, LICENSE_VERSION
from .models import PermissionAction, Role, ACLItem
from .crypto import (
    hash_password, verify_password, generate_identity_id,
    generate_license_key, verify_license_key, validate_email, validate_phone,
)
from .manager import AuthManager
from .singleton import get_auth_manager, check_permission

__all__ = [
    "LICENSE_SECRET", "LICENSE_VERSION", "PermissionAction", "Role", "ACLItem",
    "hash_password", "verify_password", "generate_identity_id",
    "generate_license_key", "verify_license_key", "validate_email", "validate_phone",
    "AuthManager", "get_auth_manager", "check_permission",
]
