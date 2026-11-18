"""支持Base64/Base32/Base58/ASCII85/URL/Hex/HTML/ROT13/Unicode/摩斯电码等20+种编解码插件。"""

from .logic import encode_decode
from .plugin import register

__all__ = ["register", "encode_decode"]
