"""计算文本或文件的MD5/SHA1/SHA224/SHA256/SHA384/SHA512/SHA3/BLAKE2/RIPEMD160等哈希值插件。"""

from .logic import hash_calc
from .plugin import register

__all__ = ["register", "hash_calc"]
