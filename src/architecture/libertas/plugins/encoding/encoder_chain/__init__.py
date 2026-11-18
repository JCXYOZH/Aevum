"""多轮编码链，支持URL/Base64/Base32/Base58/Hex/HTML/Unicode/ROT13/ROT47自由组合，支持自动检测插件。"""

from .logic import encoder_chain
from .plugin import register

__all__ = ["register", "encoder_chain"]
