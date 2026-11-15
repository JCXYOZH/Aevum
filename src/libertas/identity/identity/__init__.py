"""身份系统公共入口。"""

from .crypto import hash_password, verify_password, generate_identity_id
from .models import ContributionType, IdentityProfile, Contribution
from .manager import IdentityManager
from .singleton import get_identity_manager, add_contribution

__all__ = [
    "hash_password", "verify_password", "generate_identity_id",
    "ContributionType", "IdentityProfile", "Contribution", "IdentityManager",
    "get_identity_manager", "add_contribution",
]
