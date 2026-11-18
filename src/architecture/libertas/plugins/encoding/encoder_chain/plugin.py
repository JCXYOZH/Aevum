"""多轮编码链，支持URL/Base64/Base32/Base58/Hex/HTML/Unicode/ROT13/ROT47自由组合，支持自动检测注册入口。"""

from .logic import encoder_chain

def register(registry):
    registry.register_tool(
        "encoder_chain",
        encoder_chain,
        params={"text": "要编码的文本", "chain": "编码链（如 url,base64,hex）", "mode": "encode/decode/auto"},
        category="编码解码",
        desc="编码链，13种编码自由组合，支持自动检测"
    )
