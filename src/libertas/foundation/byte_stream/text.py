"""字节流文本解码。"""

import codecs
from typing import Any, Optional


def safe_decode(data: Any, encoding: Optional[str] = None) -> str:
    """把"编码不可知"的字节数据安全解码为文本。

    适用于子进程输出、外部文件内容等来源。解码级联**唯一实现**在
    :func:`libertas.core.text_decode.decode_bytes`（BOM → UTF-8 严格 →
    GBK/GB2312/GB18030/… 严格 → UTF-8 + errors='replace'，绝不抛异常），
    这里只做一层薄封装，避免仓库里出现第二套解码规则。

    背景：Windows 中文环境下 ``open()`` / ``subprocess(text=True)`` 默认使用区域编码
    （cp936/GBK），一旦数据其实是 UTF-8（例如 Go 系安全工具的输出）就会抛
    ``UnicodeDecodeError: 'gbk' codec can't decode byte ...``。

    Args:
        data: bytes/bytearray/memoryview；已是 str 时原样返回。
        encoding: 已知编码时优先按它解码，失败自动回落级联。
    """
    from libertas.utils.text_decode import decode_bytes
    return decode_bytes(data, encoding)[0]
