"""职责模块：crypto。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import base64
from libertas.utils.text_decode import decode_bytes
import hashlib
import hmac
import os
import zlib

class CryptoUtils:
    """加密工具集"""

    @staticmethod
    def md5(text: str) -> str:
        return hashlib.md5(text.encode()).hexdigest()

    @staticmethod
    def sha1(text: str) -> str:
        return hashlib.sha1(text.encode()).hexdigest()

    @staticmethod
    def sha256(text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    @staticmethod
    def sha512(text: str) -> str:
        return hashlib.sha512(text.encode()).hexdigest()

    @staticmethod
    def hmac_sha256(key: str, message: str) -> str:
        return hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def hmac_sha1(key: str, message: str) -> str:
        return hmac.new(key.encode(), message.encode(), hashlib.sha1).hexdigest()

    @staticmethod
    def base64_encode(text: str) -> str:
        return base64.b64encode(text.encode()).decode()

    @staticmethod
    def base64_decode(text: str) -> str:
        # 解出来的可能是任意字节（非 UTF-8）：无参 .decode() 固定按 UTF-8 解，
        # 会抛 UnicodeDecodeError（同"默认编码"缺陷族）。统一走 decode_bytes
        # （级联解码，永不抛；合法 UTF-8 输入结果与改前逐字一致）。
        return decode_bytes(base64.b64decode(text.encode()))[0]

    @staticmethod
    def base64url_encode(text: str) -> str:
        return base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')

    @staticmethod
    def base64url_decode(text: str) -> str:
        padding = 4 - len(text) % 4
        if padding != 4:
            text += '=' * padding
        # 同上：任意字节不能无参 .decode()
        return decode_bytes(base64.urlsafe_b64decode(text.encode()))[0]

    @staticmethod
    def generate_salt(length: int = 16) -> str:
        return os.urandom(length).hex()

    @staticmethod
    def hash_password(password: str, salt: str = "", iterations: int = 100000) -> Tuple[str, str]:
        if not salt:
            salt = CryptoUtils.generate_salt()
        dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), iterations)
        return dk.hex(), salt

    @staticmethod
    def verify_password(password: str, stored_hash: str, salt: str,
                        iterations: int = 100000) -> bool:
        dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), iterations)
        return hmac.compare_digest(dk.hex(), stored_hash)

    @staticmethod
    def generate_token(length: int = 32) -> str:
        return os.urandom(length).hex()

    @staticmethod
    def generate_api_key(prefix: str = "mrk") -> str:
        return f"{prefix}_{os.urandom(24).hex()}"

    @staticmethod
    def crc32(text: str) -> int:
        return zlib.crc32(text.encode()) & 0xffffffff

    @staticmethod
    def adler32(text: str) -> int:
        return zlib.adler32(text.encode()) & 0xffffffff
