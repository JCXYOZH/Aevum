"""插件: 增强版编码链
版本: 2.0.0
分类: 编码解码
描述: 多轮编码链，支持URL/Base64/Base32/Base58/Hex/HTML/Unicode/ROT13/ROT47自由组合，支持自动检测
"""
import base64
import urllib.parse
import html
import codecs
import re


def encode_url(s: str) -> str:
    return urllib.parse.quote(s, safe="")

def decode_url(s: str) -> str:
    return urllib.parse.unquote(s)

def encode_b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()

def decode_b64(s: str) -> str:
    return base64.b64decode(s).decode(errors="replace")

def encode_b32(s: str) -> str:
    return base64.b32encode(s.encode()).decode()

def decode_b32(s: str) -> str:
    return base64.b32decode(s.upper()).decode(errors="replace")

def encode_b58(s: str) -> str:
    """Base58编码（比特币风格）"""
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    data = s.encode()
    n = int.from_bytes(data, 'big')
    result = []
    while n > 0:
        n, r = divmod(n, 58)
        result.append(alphabet[r])
    pad = sum(1 for b in data if b == 0)
    return alphabet[0] * pad + ''.join(reversed(result))

def decode_b58(s: str) -> str:
    """Base58解码"""
    alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    n = 0
    for char in s:
        if char not in alphabet:
            raise ValueError(f"无效的Base58字符: {char}")
        n = n * 58 + alphabet.index(char)
    pad = sum(1 for c in s if c == alphabet[0])
    result = n.to_bytes((n.bit_length() + 7) // 8, 'big') if n > 0 else b''
    return (b'\x00' * pad + result).decode(errors="replace")

def encode_hex(s: str) -> str:
    return s.encode().hex()

def decode_hex(s: str) -> str:
    return bytes.fromhex(s.strip().replace(' ', '').replace('0x', '')).decode(errors="replace")

def encode_html(s: str) -> str:
    return html.escape(s)

def decode_html(s: str) -> str:
    return html.unescape(s)

def encode_unicode(s: str) -> str:
    return "".join(f"\\u{ord(c):04x}" for c in s)

def decode_unicode(s: str) -> str:
    return s.encode().decode("unicode_escape")

def encode_rot13(s: str) -> str:
    return codecs.encode(s, "rot_13")

def decode_rot13(s: str) -> str:
    return codecs.decode(s, "rot_13")

def encode_rot47(s: str) -> str:
    return ''.join(chr(33 + ((ord(c) + 14) % 94)) if 33 <= ord(c) <= 126 else c for c in s)

def decode_rot47(s: str) -> str:
    return encode_rot47(s)  # ROT47是自反的

def encode_binary(s: str) -> str:
    return ' '.join(format(ord(c), '08b') for c in s)

def decode_binary(s: str) -> str:
    return ''.join(chr(int(b, 2)) for b in s.split())

def encode_octal(s: str) -> str:
    return ' '.join(format(ord(c), '03o') for c in s)

def decode_octal(s: str) -> str:
    return ''.join(chr(int(o, 8)) for o in s.split())

def encode_ascii85(s: str) -> str:
    return base64.a85encode(s.encode()).decode()

def decode_ascii85(s: str) -> str:
    return base64.a85decode(s).decode(errors="replace")


ENCODERS = {
    "url": (encode_url, decode_url, "URL编码"),
    "base64": (encode_b64, decode_b64, "Base64编码"),
    "base32": (encode_b32, decode_b32, "Base32编码"),
    "base58": (encode_b58, decode_b58, "Base58编码"),
    "ascii85": (encode_ascii85, decode_ascii85, "ASCII85编码"),
    "hex": (encode_hex, decode_hex, "Hex编码"),
    "html": (encode_html, decode_html, "HTML实体编码"),
    "unicode": (encode_unicode, decode_unicode, "Unicode转义编码"),
    "rot13": (encode_rot13, decode_rot13, "ROT13编码"),
    "rot47": (encode_rot47, decode_rot47, "ROT47编码"),
    "binary": (encode_binary, decode_binary, "二进制编码"),
    "octal": (encode_octal, decode_octal, "八进制编码"),
}


def _auto_detect_chain(text, max_depth=5):
    """自动检测编码链"""
    detected = []
    current = text
    for _ in range(max_depth):
        # 检测URL编码
        if re.search(r'%[0-9A-Fa-f]{2}', current):
            try:
                decoded = decode_url(current)
                if decoded != current:
                    detected.append("url")
                    current = decoded
                    continue
            except Exception:
                pass
        # 检测Base64
        if re.match(r'^[A-Za-z0-9+/]{20,}={0,2}$', current.strip()):
            try:
                decoded = decode_b64(current)
                if decoded and all(32 <= ord(c) < 127 or c in '\n\r\t' for c in decoded[:50]):
                    detected.append("base64")
                    current = decoded
                    continue
            except Exception:
                pass
        # 检测Hex
        if re.match(r'^[0-9a-fA-F]{20,}$', current.strip()):
            try:
                decoded = decode_hex(current)
                if decoded and all(32 <= ord(c) < 127 or c in '\n\r\t' for c in decoded[:50]):
                    detected.append("hex")
                    current = decoded
                    continue
            except Exception:
                pass
        # 检测Unicode转义
        if re.search(r'\\u[0-9a-fA-F]{4}', current):
            try:
                decoded = decode_unicode(current)
                if decoded != current:
                    detected.append("unicode")
                    current = decoded
                    continue
            except Exception:
                pass
        # 检测HTML实体
        if re.search(r'&[a-zA-Z]+;|&#\d+;', current):
            try:
                decoded = decode_html(current)
                if decoded != current:
                    detected.append("html")
                    current = decoded
                    continue
            except Exception:
                pass
        break
    return detected, current


def register(registry):
    registry.register_tool(
        "encoder_chain",
        encoder_chain,
        params={"text": "要编码的文本", "chain": "编码链（如 url,base64,hex）", "mode": "encode/decode/auto"},
        category="编码解码",
        desc="增强版编码链，13种编码自由组合，支持自动检测"
    )


def encoder_chain(text: str = "", chain: str = "url,base64", mode: str = "encode") -> dict:
    """按链顺序编码/解码（增强版）"""
    if not text:
        return {"success": False, "error": "请输入文本"}
    mode = mode.lower().strip()
    # 自动检测模式
    if mode == "auto":
        detected, decoded = _auto_detect_chain(text)
        if detected:
            return {
                "success": True,
                "result": {
                    "模式": "自动检测",
                    "检测到的编码链": detected,
                    "解码结果": decoded,
                    "原始文本": text[:100],
                }
            }
        else:
            return {"success": False, "error": "未能自动检测到编码链",
                    "支持的编码": list(ENCODERS.keys())}
    steps = [s.strip().lower() for s in chain.split(",") if s.strip()]
    if not steps:
        return {"success": False, "error": "请指定编码链"}
    result = text
    trace = []
    do_decode = (mode == "decode")
    # 解码时反向执行
    if do_decode:
        steps = list(reversed(steps))
    for step in steps:
        if step not in ENCODERS:
            return {"success": False, "error": f"不支持的编码: {step}",
                    "可选编码": list(ENCODERS.keys())}
        enc, dec, desc = ENCODERS[step]
        try:
            result = dec(result) if do_decode else enc(result)
            trace.append({"步骤": step, "说明": desc, "结果": result[:100]})
        except Exception as e:
            return {"success": False, "error": f"{step} 失败: {e}", "trace": trace}
    return {
        "success": True,
        "result": {
            "模式": mode,
            "编码链": steps if not do_decode else list(reversed(steps)),
            "输出": result,
            "输出长度": len(result),
            "执行步骤": trace,
            "支持的编码": list(ENCODERS.keys()),
        }
    }
