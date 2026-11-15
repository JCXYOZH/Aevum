"""
广域网通信模块（MQTT 中继）
- 通过公共 MQTT  broker 中继消息，跨互联网通信
- 房间制：用户输入房间号+密码加入同一房间
- 消息加密：密码派生密钥，XOR 流加密 + Base64
- 支持文字消息和文件传输（base64编码，限制大小）
- 纯标准库实现，无外部依赖
"""
import os
import json
import time
import socket
import struct
import hashlib
import base64
import threading
import uuid
from typing import Dict, List, Optional, Callable
from datetime import datetime

def _encrypt(data: bytes, key: bytes) -> bytes:
    if not key:
        return data
    out = bytearray(len(data))
    klen = len(key)
    for i, b in enumerate(data):
        out[i] = b ^ key[i % klen]
    return bytes(out)

def _derive_key(password: str) -> bytes:
    return hashlib.sha256(password.encode("utf-8")).digest()

def _encode_msg(msg: dict, key: bytes) -> bytes:
    raw = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    enc = _encrypt(raw, key)
    return base64.b64encode(enc)

def _decode_msg(payload: bytes, key: bytes) -> Optional[dict]:
    try:
        raw = base64.b64decode(payload)
        dec = _encrypt(raw, key)
        return json.loads(dec.decode("utf-8"))
    except Exception:
        return None
