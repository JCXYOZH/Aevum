"""职责模块：functions。"""

from __future__ import annotations

import hashlib
import os

from .constants import KEY_SIZE

def node_id_to_int(node_id: str) -> int:
    """节点ID（十六进制字符串）转整数"""
    return int(node_id, 16)

def int_to_node_id(value: int) -> str:
    """整数转节点ID"""
    return format(value, f"0{KEY_SIZE // 4}x")

def xor_distance(node_id1: str, node_id2: str) -> int:
    """计算两个节点ID的XOR距离"""
    return node_id_to_int(node_id1) ^ node_id_to_int(node_id2)

def distance_bucket(distance: int) -> int:
    """计算距离属于哪个K桶（0-159）"""
    if distance == 0:
        return 0
    return distance.bit_length() - 1

def generate_random_id() -> str:
    """生成随机节点ID"""
    import os
    return hashlib.sha1(os.urandom(32)).hexdigest()

def compute_key(key: str) -> str:
    """计算内容键的哈希（用于DHT存储）"""
    return hashlib.sha1(key.encode("utf-8")).hexdigest()
