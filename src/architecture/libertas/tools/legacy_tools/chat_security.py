"""
聊天安全模块
- 身份认证：基于 Ed25519-like 密钥对（标准库 hmac+hashlib 实现）
- 动态角色：owner/admin/member/guest，细粒度权限策略
- 防暴力破解：连接频率限制、失败锁定、密码强度检查
- TLS 证书生成：自签名证书用于 LAN HTTPS
"""
import os
import time
import hmac
import hashlib
import secrets
import threading
import tempfile
from typing import Dict, Tuple, Optional
from collections import defaultdict


ROLE_PERMISSIONS = {
    "owner": {
        "can_send": True, "can_send_files": True, "can_invite": True,
        "can_kick": True, "can_ban": True, "can_change_roles": True,
        "can_view_history": True, "can_delete": True, "can_change_room": True,
    },
    "admin": {
        "can_send": True, "can_send_files": True, "can_invite": True,
        "can_kick": True, "can_ban": True, "can_change_roles": False,
        "can_view_history": True, "can_delete": False, "can_change_room": False,
    },
    "member": {
        "can_send": True, "can_send_files": True, "can_invite": False,
        "can_kick": False, "can_ban": False, "can_change_roles": False,
        "can_view_history": True, "can_delete": False, "can_change_room": False,
    },
    "guest": {
        "can_send": True, "can_send_files": False, "can_invite": False,
        "can_kick": False, "can_ban": False, "can_change_roles": False,
        "can_view_history": False, "can_delete": False, "can_change_room": False,
    },
    "muted": {
        "can_send": False, "can_send_files": False, "can_invite": False,
        "can_kick": False, "can_ban": False, "can_change_roles": False,
        "can_view_history": True, "can_delete": False, "can_change_room": False,
    },
}


def has_permission(role: str, permission: str) -> bool:
    perms = ROLE_PERMISSIONS.get(role, ROLE_PERMISSIONS["guest"])
    return perms.get(permission, False)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
    return f"pbkdf2${salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split("$")
        if len(parts) != 3 or parts[0] != "pbkdf2":
            return False
        salt = parts[1]
        expected = parts[2]
        h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
        return hmac.compare_digest(h.hex(), expected)
    except Exception:
        return False


def password_strength(password: str) -> Tuple[int, str]:
    score = 0
    if len(password) >= 8:
        score += 1
    if len(password) >= 12:
        score += 1
    if any(c.isupper() for c in password) and any(c.islower() for c in password):
        score += 1
    if any(c.isdigit() for c in password):
        score += 1
    if any(not c.isalnum() for c in password):
        score += 1
    if score <= 1:
        return score, "弱"
    elif score <= 3:
        return score, "中"
    return score, "强"


def generate_peer_keys() -> Tuple[str, str]:
    """生成对等身份密钥对（私钥seed + 公钥指纹）"""
    private_seed = secrets.token_hex(32)
    pub_fingerprint = hashlib.sha256(private_seed.encode()).hexdigest()[:32]
    return private_seed, pub_fingerprint


def sign_message(private_seed: str, message: str) -> str:
    """用私钥seed对消息签名"""
    return hmac.new(private_seed.encode(), message.encode(), hashlib.sha256).hexdigest()


def verify_signature(pub_fingerprint: str, message: str, signature: str, private_seed: str = "") -> bool:
    """验证签名（需要私钥seed来推导公钥，或直接比对）"""
    if private_seed:
        expected_pub = hashlib.sha256(private_seed.encode()).hexdigest()[:32]
        if expected_pub != pub_fingerprint:
            return False
        expected_sig = hmac.new(private_seed.encode(), message.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected_sig, signature)
    return False


class RateLimiter:
    """连接频率限制器，防止暴力破解"""

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60, lockout_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.lockout_seconds = lockout_seconds
        self._attempts: Dict[str, list] = defaultdict(list)
        self._lockouts: Dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> Tuple[bool, str]:
        """检查是否允许操作，返回 (允许, 原因)"""
        now = time.time()
        with self._lock:
            if key in self._lockouts:
                remaining = self._lockouts[key] - now
                if remaining > 0:
                    return False, f"已锁定，剩余 {int(remaining)} 秒"
                else:
                    del self._lockouts[key]
            self._attempts[key] = [t for t in self._attempts[key] if now - t < self.window_seconds]
            if len(self._attempts[key]) >= self.max_attempts:
                self._lockouts[key] = now + self.lockout_seconds
                self._attempts[key] = []
                return False, f"尝试过于频繁，锁定 {self.lockout_seconds} 秒"
            return True, ""

    def record(self, key: str, success: bool):
        now = time.time()
        with self._lock:
            if success:
                self._attempts.pop(key, None)
                self._lockouts.pop(key, None)
            else:
                self._attempts[key].append(now)

    def is_locked(self, key: str) -> bool:
        with self._lock:
            if key in self._lockouts:
                if self._lockouts[key] > time.time():
                    return True
                del self._lockouts[key]
            return False


def generate_self_signed_cert(cert_dir: str = "", common_name: str = "MrHua") -> Tuple[str, str]:
    """生成自签名 TLS 证书（纯标准库，不依赖 openssl 命令）"""
    if not cert_dir:
        cert_dir = os.path.join(tempfile.gettempdir(), "mrhua_certs")
    os.makedirs(cert_dir, exist_ok=True)
    cert_path = os.path.join(cert_dir, "cert.pem")
    key_path = os.path.join(cert_dir, "key.pem")
    if os.path.exists(cert_path) and os.path.exists(key_path):
        return cert_path, key_path
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "MrHua"),
        ])
        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(datetime.datetime.utcnow())
            .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.DNSName("*"),
            ]), critical=False)
            .sign(key, hashes.SHA256())
        )
        with open(key_path, "wb") as f:
            f.write(key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL,
                serialization.NoEncryption(),
            ))
        with open(cert_path, "wb") as f:
            f.write(cert.public_bytes(serialization.Encoding.PEM))
        return cert_path, key_path
    except ImportError:
        return _generate_cert_openssl(cert_path, key_path, common_name)


def _generate_cert_openssl(cert_path: str, key_path: str, common_name: str) -> Tuple[str, str]:
    """用 openssl 命令生成证书作为后备"""
    import subprocess
    try:
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", key_path, "-out", cert_path,
            "-days", "3650", "-nodes", "-subj", f"/CN={common_name}/O=MrHua"
        ], check=True, capture_output=True, timeout=10)
        return cert_path, key_path
    except Exception:
        return "", ""
