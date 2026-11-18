"""支持Base64/Base32/Base58/ASCII85/URL/Hex/HTML/ROT13/Unicode/摩斯电码等20+种编解码注册入口。"""

from .logic import encode_decode

def register(registry):
    registry.register_tool(
        "encode_decode",
        encode_decode,
        params={"text": "要处理的文本",
                "mode": "模式：base64enc、base64dec、base64urlenc、base32enc、base58enc、urlenc、hexenc、htmlenc 等"},
        category="工具",
        desc="编解码器，支持20+种编码格式"
    )
