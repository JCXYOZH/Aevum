"""插件: 增强版编码解码器
版本: 2.0.0
分类: 工具
描述: 支持Base64/Base32/Base58/ASCII85/URL/Hex/HTML/ROT13/Unicode/摩斯电码等20+种编解码
"""
import base64
import urllib.parse
import html
import codecs
import binascii


def register(registry):
    registry.register_tool(
        "encode_decode",
        encode_decode,
        params={"text": "要处理的文本",
                "mode": "模式(见下方支持列表，也兼容 base64/url/hex/html 这类简写)",
                "action": "encode / decode（可选，配合 base64 这类简写使用）"},
        category="工具",
        desc="增强版编解码器，支持20+种编码格式"
    )


# 支持的模式列表
SUPPORTED_MODES = {
    "base64enc": "Base64编码",
    "base64dec": "Base64解码",
    "base64urlenc": "Base64URL编码",
    "base64urldec": "Base64URL解码",
    "base32enc": "Base32编码",
    "base32dec": "Base32解码",
    "base58enc": "Base58编码（比特币风格）",
    "base58dec": "Base58解码",
    "ascii85enc": "ASCII85编码",
    "ascii85dec": "ASCII85解码",
    "urlenc": "URL编码",
    "urldec": "URL解码",
    "hexenc": "Hex编码",
    "hexdec": "Hex解码",
    "htmlenc": "HTML实体编码",
    "htmldec": "HTML实体解码",
    "rot13": "ROT13编码",
    "rot47": "ROT47编码",
    "unicode_escape": "Unicode转义编码",
    "unicode_unescape": "Unicode转义解码",
    "binary": "二进制编码",
    "octal": "八进制编码",
    "morse_enc": "摩斯电码编码",
    "morse_dec": "摩斯电码解码",
    "reverse": "字符串反转",
    "uppercase": "转大写",
    "lowercase": "转小写",
}

# Base58字母表（比特币风格）
BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

# 摩斯电码表
MORSE_CODE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '0': '-----', '1': '.----', '2': '..---',
    '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...',
    '8': '---..', '9': '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..',
    "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
    '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.',
    '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
}


def _base58_encode(data):
    """Base58编码"""
    if isinstance(data, str):
        data = data.encode()
    n = int.from_bytes(data, 'big')
    result = []
    while n > 0:
        n, r = divmod(n, 58)
        result.append(BASE58_ALPHABET[r])
    # 处理前导零
    pad = 0
    for byte in data:
        if byte == 0:
            pad += 1
        else:
            break
    return BASE58_ALPHABET[0] * pad + ''.join(reversed(result))


def _base58_decode(s):
    """Base58解码"""
    n = 0
    for char in s:
        if char not in BASE58_ALPHABET:
            raise ValueError(f"无效的Base58字符: {char}")
        n = n * 58 + BASE58_ALPHABET.index(char)
    # 处理前导零
    pad = 0
    for char in s:
        if char == BASE58_ALPHABET[0]:
            pad += 1
        else:
            break
    result = n.to_bytes((n.bit_length() + 7) // 8, 'big') if n > 0 else b''
    return b'\x00' * pad + result


def _morse_encode(text):
    """摩斯电码编码"""
    result = []
    for char in text.upper():
        if char == ' ':
            result.append('/')
        elif char in MORSE_CODE:
            result.append(MORSE_CODE[char])
        else:
            result.append('?')
    return ' '.join(result)


def _morse_decode(code):
    """摩斯电码解码"""
    reverse_morse = {v: k for k, v in MORSE_CODE.items()}
    result = []
    for word in code.split('/'):
        for char in word.strip().split():
            if char in reverse_morse:
                result.append(reverse_morse[char])
            elif char == '?':
                result.append('?')
        result.append(' ')
    return ''.join(result).strip()


def encode_decode(text: str = "", mode: str = "base64enc", action: str = "") -> dict:
    """编解码（增强版）"""
    if not text:
        return {"success": False, "error": "请输入文本"}
    try:
        result = ""
        mode = mode.lower().strip()
        action = (action or "").lower().strip()
        # 兼容原生工具 encode_decode 的写法（mode=base64 + action=encode/decode），
        # 否则同一个模型在两套工具上要用两套模式名，很容易混用导致"未知模式"。
        _enc_alias = {
            "base64": "base64enc", "base64url": "base64urlenc", "base32": "base32enc",
            "base58": "base58enc", "ascii85": "ascii85enc", "a85": "ascii85enc",
            "url": "urlenc", "hex": "hexenc", "html": "htmlenc",
        }
        _dec_alias = {
            "base64": "base64dec", "base64url": "base64urldec", "base32": "base32dec",
            "base58": "base58dec", "ascii85": "ascii85dec", "a85": "ascii85dec",
            "url": "urldec", "hex": "hexdec", "html": "htmldec",
        }
        if action in ("decode", "dec"):
            mode = _dec_alias.get(mode, mode)
        elif action in ("encode", "enc"):
            mode = _enc_alias.get(mode, mode)
        elif mode in _enc_alias:
            mode = _enc_alias[mode]
        if mode == "base64enc":
            result = base64.b64encode(text.encode()).decode()
        elif mode == "base64dec":
            result = base64.b64decode(text).decode("utf-8", errors="replace")
        elif mode == "base64urlenc":
            result = base64.urlsafe_b64encode(text.encode()).rstrip(b'=').decode()
        elif mode == "base64urldec":
            padding = 4 - len(text) % 4
            if padding != 4:
                text += '=' * padding
            result = base64.urlsafe_b64decode(text).decode("utf-8", errors="replace")
        elif mode == "base32enc":
            result = base64.b32encode(text.encode()).decode()
        elif mode == "base32dec":
            result = base64.b32decode(text.upper()).decode("utf-8", errors="replace")
        elif mode == "base58enc":
            result = _base58_encode(text)
        elif mode == "base58dec":
            result = _base58_decode(text).decode("utf-8", errors="replace")
        elif mode == "ascii85enc":
            result = base64.a85encode(text.encode()).decode()
        elif mode == "ascii85dec":
            result = base64.a85decode(text).decode("utf-8", errors="replace")
        elif mode == "urlenc":
            result = urllib.parse.quote(text, safe="")
        elif mode == "urldec":
            result = urllib.parse.unquote(text)
        elif mode == "hexenc":
            result = text.encode().hex()
        elif mode == "hexdec":
            result = bytes.fromhex(text.strip().replace(' ', '').replace('0x', '')).decode("utf-8", errors="replace")
        elif mode == "htmlenc":
            result = html.escape(text)
        elif mode == "htmldec":
            result = html.unescape(text)
        elif mode == "rot13":
            result = codecs.encode(text, "rot_13")
        elif mode == "rot47":
            result = ''.join(chr(33 + ((ord(c) + 14) % 94)) if 33 <= ord(c) <= 126 else c for c in text)
        elif mode == "unicode_escape":
            result = text.encode('unicode_escape').decode()
        elif mode == "unicode_unescape":
            result = text.encode().decode('unicode_escape')
        elif mode == "binary":
            result = ' '.join(format(ord(c), '08b') for c in text)
        elif mode == "octal":
            result = ' '.join(format(ord(c), '03o') for c in text)
        elif mode == "morse_enc":
            result = _morse_encode(text)
        elif mode == "morse_dec":
            result = _morse_decode(text)
        elif mode == "reverse":
            result = text[::-1]
        elif mode == "uppercase":
            result = text.upper()
        elif mode == "lowercase":
            result = text.lower()
        else:
            return {
                "success": False,
                "error": f"未知模式: {mode}",
                "支持的模式": SUPPORTED_MODES,
            }
        return {
            "success": True,
            "result": {
                "输入": text[:200],
                "输入长度": len(text),
                "模式": mode,
                "模式说明": SUPPORTED_MODES.get(mode, "未知"),
                "输出": result,
                "输出长度": len(result),
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
