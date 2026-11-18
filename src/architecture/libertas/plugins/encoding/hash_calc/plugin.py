"""计算文本或文件的MD5/SHA1/SHA224/SHA256/SHA384/SHA512/SHA3/BLAKE2/RIPEMD160等哈希值注册入口。"""

from .logic import hash_calc

def register(registry):
    registry.register_tool(
        "hash_calc",
        hash_calc,
        params={"text": "要计算的文本", "file_path": "文件路径（可选，优先于text）",
                "algo": "算法(md5/sha1/sha224/sha256/sha384/sha512/sha3_256/sha3_512/blake2b/blake2s/ripemd160/all)"},
        category="工具",
        desc="哈希计算器，支持15+种算法，文本和文件哈希"
    )
