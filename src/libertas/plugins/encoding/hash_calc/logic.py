"""计算文本或文件的MD5/SHA1/SHA224/SHA256/SHA384/SHA512/SHA3/BLAKE2/RIPEMD160等哈希值实现。"""

import hashlib

import os

SUPPORTED_ALGOS = {
    "md5": {"name": "MD5", "bits": 128, "secure": False, "note": "已被破解，不推荐用于安全场景"},
    "sha1": {"name": "SHA-1", "bits": 160, "secure": False, "note": "已被碰撞攻击，不推荐"},
    "sha224": {"name": "SHA-224", "bits": 224, "secure": True, "note": "SHA-2家族"},
    "sha256": {"name": "SHA-256", "bits": 256, "secure": True, "note": "SHA-2家族，推荐使用"},
    "sha384": {"name": "SHA-384", "bits": 384, "secure": True, "note": "SHA-2家族"},
    "sha512": {"name": "SHA-512", "bits": 512, "secure": True, "note": "SHA-2家族，高安全性"},
    "sha3_224": {"name": "SHA3-224", "bits": 224, "secure": True, "note": "SHA-3家族（Keccak）"},
    "sha3_256": {"name": "SHA3-256", "bits": 256, "secure": True, "note": "SHA-3家族（Keccak）"},
    "sha3_384": {"name": "SHA3-384", "bits": 384, "secure": True, "note": "SHA-3家族（Keccak）"},
    "sha3_512": {"name": "SHA3-512", "bits": 512, "secure": True, "note": "SHA-3家族（Keccak）"},
    "blake2b": {"name": "BLAKE2b", "bits": 512, "secure": True, "note": "BLAKE2，比SHA-3更快"},
    "blake2s": {"name": "BLAKE2s", "bits": 256, "secure": True, "note": "BLAKE2，32位平台优化"},
    "ripemd160": {"name": "RIPEMD-160", "bits": 160, "secure": True, "note": "RIPEMD家族，比特币使用"},
}

def _get_hash_func(algo):
    """获取哈希函数"""
    if algo == "ripemd160":
        # RIPEMD160需要通过new方法创建
        return lambda: hashlib.new('ripemd160')
    return getattr(hashlib, algo)

def hash_calc(text: str = "", file_path: str = "", algo: str = "all") -> dict:
    """计算哈希"""
    if not text and not file_path:
        return {"success": False, "error": "请输入文本或文件路径"}
    try:
        # 确定输入源
        if file_path and os.path.isfile(file_path):
            input_type = "文件"
            input_name = file_path
            file_size = os.path.getsize(file_path)
        else:
            input_type = "文本"
            input_name = text[:50] + "..." if len(text) > 50 else text
            file_size = len(text.encode())
        # 确定算法列表
        if algo == "all":
            algos_to_calc = ["md5", "sha1", "sha256", "sha512", "sha3_256", "blake2b"]
        elif algo in SUPPORTED_ALGOS:
            algos_to_calc = [algo]
        else:
            return {
                "success": False,
                "error": f"不支持的算法: {algo}",
                "支持的算法": list(SUPPORTED_ALGOS.keys()),
            }
        # 计算哈希
        results = {}
        for algo_name in algos_to_calc:
            try:
                hash_func = _get_hash_func(algo_name)
                h = hash_func()
                if file_path and os.path.isfile(file_path):
                    # 分块读取文件，避免大文件内存溢出
                    with open(file_path, 'rb') as f:
                        while True:
                            chunk = f.read(8192)
                            if not chunk:
                                break
                            h.update(chunk)
                else:
                    h.update(text.encode())
                results[algo_name] = {
                    "hash": h.hexdigest(),
                    "name": SUPPORTED_ALGOS[algo_name]["name"],
                    "bits": SUPPORTED_ALGOS[algo_name]["bits"],
                    "secure": SUPPORTED_ALGOS[algo_name]["secure"],
                    "note": SUPPORTED_ALGOS[algo_name]["note"],
                }
            except Exception as e:
                results[algo_name] = {"error": str(e)}
        # 安全建议
        security_advice = []
        if "md5" in results and "hash" in results.get("md5", {}):
            security_advice.append("MD5已被破解，不推荐用于密码存储或数字签名")
        if "sha1" in results and "hash" in results.get("sha1", {}):
            security_advice.append("SHA-1已被碰撞攻击，建议迁移到SHA-256或更高")
        if not any(results.get(a, {}).get("secure") for a in algos_to_calc):
            security_advice.append("建议使用SHA-256/SHA-512/SHA3/BLAKE2等安全算法")
        return {
            "success": True,
            "result": {
                "输入类型": input_type,
                "输入内容": input_name,
                "输入大小": f"{file_size} 字节",
                "计算算法数": len(results),
                "哈希结果": results,
                "安全建议": security_advice,
                "支持的全部算法": list(SUPPORTED_ALGOS.keys()),
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
