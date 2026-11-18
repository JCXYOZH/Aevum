"""请求体编码、压缩与解密。"""

import base64
import gzip
import hashlib
import os
import re
import struct
import zlib
from typing import Any, Dict, Optional, Tuple

from .errors import ByteStreamError
from .text import safe_decode


def _get_encryption_key() -> bytes:
    """获取加密密钥，优先从环境变量 LIBERTAS_ENCRYPTION_KEY 获取"""
    key = os.environ.get('LIBERTAS_ENCRYPTION_KEY', 'libertas-default-encryption-key-2024')
    return hashlib.sha256(key.encode('utf-8')).digest()

def detect_request_encoding(headers: Dict[str, str]) -> Dict[str, Any]:
    """检测请求头中的编码信息"""
    result = {
        'compression': None,
        'encryption': None,
        'iv': None,
        'raw': False
    }
    content_encoding = headers.get('Content-Encoding', '').lower().strip()
    if content_encoding:
        encodings = [e.strip() for e in content_encoding.split(',')]
        for enc in encodings:
            if enc in ('gzip', 'x-gzip'):
                result['compression'] = 'gzip'
            elif enc == 'deflate':
                result['compression'] = 'deflate'
            elif enc == 'br':
                result['compression'] = 'br'
    x_encryption = headers.get('X-Encryption', '').lower().strip()
    if x_encryption:
        if 'aes-256-cbc' in x_encryption:
            result['encryption'] = 'aes-256-cbc'
        elif 'aes-128-cbc' in x_encryption:
            result['encryption'] = 'aes-128-cbc'
    x_iv = headers.get('X-IV', '')
    if x_iv:
        try:
            result['iv'] = base64.b64decode(x_iv)
        except Exception:
            result['iv'] = None
    if headers.get('X-Raw', '').lower() in ('1', 'true', 'yes'):
        result['raw'] = True
    return result

def decompress_data(data: bytes, algorithm: str) -> bytes:
    """按指定算法解压数据"""
    try:
        if algorithm == 'gzip':
            return gzip.decompress(data)
        elif algorithm == 'deflate':
            try:
                return zlib.decompress(data)
            except zlib.error:
                return zlib.decompress(data, -zlib.MAX_WBITS)
        elif algorithm == 'br':
            if not _HAS_BROTLI:
                raise ByteStreamError("brotli库未安装，请执行: pip install brotli")
            return brotli.decompress(data)
        else:
            raise ByteStreamError(f"不支持的压缩算法: {algorithm}")
    except ByteStreamError:
        raise
    except Exception as e:
        raise ByteStreamError(f"解压失败({algorithm}): {str(e)}")

def decrypt_data(data: bytes, algorithm: str, iv: Optional[bytes] = None) -> bytes:
    """解密数据"""
    if not _HAS_PYCRYPTODOME:
        raise ByteStreamError("pycryptodome库未安装，请执行: pip install pycryptodome")
    try:
        key = _get_encryption_key()
        if algorithm == 'aes-128-cbc':
            key = key[:16]
        elif algorithm == 'aes-256-cbc':
            key = key[:32]
        else:
            raise ByteStreamError(f"不支持的加密算法: {algorithm}")
        if iv is None:
            if len(data) < 16:
                raise ByteStreamError("数据太短，无法读取IV")
            iv = data[:16]
            data = data[16:]
        cipher = AES.new(key, AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(data)
        try:
            decrypted = unpad(decrypted, AES.block_size)
        except ValueError:
            pass
        return decrypted
    except ByteStreamError:
        raise
    except Exception as e:
        raise ByteStreamError(f"解密失败({algorithm}): {str(e)}")

def decode_request_body(data: bytes, headers: Dict[str, str]) -> Tuple[bytes, Dict[str, Any]]:
    """解码请求体，先解密后解压"""
    info = {
        'original_size': len(data),
        'decoded_size': len(data),
        'compression_used': None,
        'encryption_used': None,
        'steps': []
    }
    if not data:
        return data, info
    encoding = detect_request_encoding(headers)
    result = data
    if encoding['encryption']:
        info['encryption_used'] = encoding['encryption']
        info['steps'].append(f"decrypt:{encoding['encryption']}")
        result = decrypt_data(result, encoding['encryption'], encoding['iv'])
    if encoding['compression']:
        info['compression_used'] = encoding['compression']
        info['steps'].append(f"decompress:{encoding['compression']}")
        result = decompress_data(result, encoding['compression'])
    info['decoded_size'] = len(result)
    return result, info

def encode_response_body(data: bytes, headers: Dict[str, str],
                         compression: Optional[str] = None,
                         encryption: Optional[str] = None) -> Tuple[bytes, Dict[str, str]]:
    """编码响应体，先压缩后加密"""
    result = data
    if compression:
        try:
            if compression == 'gzip':
                result = gzip.compress(result, compresslevel=6)
            elif compression == 'deflate':
                result = zlib.compress(result)
            elif compression == 'br' and _HAS_BROTLI:
                result = brotli.compress(result)
            headers['Content-Encoding'] = compression
        except Exception:
            pass
    if encryption and _HAS_PYCRYPTODOME:
        try:
            key = _get_encryption_key()
            if encryption == 'aes-128-cbc':
                key = key[:16]
            elif encryption == 'aes-256-cbc':
                key = key[:32]
            else:
                encryption = None
            if encryption:
                iv = os.urandom(16)
                cipher = AES.new(key, AES.MODE_CBC, iv)
                padded = pad(result, AES.block_size)
                encrypted = cipher.encrypt(padded)
                result = iv + encrypted
                headers['X-Encryption'] = encryption
        except Exception:
            pass
    headers['Content-Length'] = str(len(result))
    return result, headers

def is_encoded_request(headers: Dict[str, str]) -> bool:
    """检查请求是否需要解码"""
    encoding = detect_request_encoding(headers)
    return encoding['compression'] is not None or encoding['encryption'] is not None
