"""
外部命令输出的文本解码与失败文案助手。

背景（用户报障）::

    UnicodeDecodeError: 'gbk' codec can't decode byte 0x9a in position 29
    【工具执行失败: curl】未知错误

Windows 中文环境（区域编码 cp936/gbk）下，**未显式指定 encoding** 的
``open()`` / ``subprocess(..., text=True)`` 会按系统区域编码解码；而大多数
安全工具（httpx / nuclei / subfinder / katana / dig ...）输出的其实是 UTF-8，
于是解码抛 ``UnicodeDecodeError`` —— 工具本身跑成功了，结果却整段被丢弃，
用户只看到一条原始异常文本（更糟的是被 bare except 吞成"0 条结果"）。

本模块把解码级联收敛到一处，做法与仓库既有实现一致：

* ``core/byte_stream.ResponseProcessor.detect_charset``
* ``core/sandbox_runner.SandboxRunner._safe_decode``

顺序：BOM → UTF-8(严格) → GBK/GB2312/GB18030(严格) → BIG5/Shift_JIS/EUC-KR(严格)
→ UTF-8(errors="replace")。

需要说明的是：BIG5/Shift_JIS/EUC-KR 三个候选**只有当 GBK 系全部解码失败时才会被
尝试**。GBK 对它们的字节流往往也能"严格解码成功"（只是结果是乱码，而不是报错），
所以这三个候选实际很少命中——本模块的定位是"绝不因默认编码丢结果 / 绝不抛异常"，
不是"自动识别任意 CJK 编码"。确实需要精确识别这些编码时，请由调用方通过
``encoding=`` 显式指定，或在上层引入 chardet 之类的编码检测。

与 ``byte_stream`` 的一处有意差异：把 "UTF-8 + replace" 放在 latin-1 之前。
理由是"UTF-8 内容里混入个别非法字节"是最常见的形态（本次报障即是）：此时
UTF-8+replace 能保住全部中文、只把坏字节变成 U+FFFD；而 latin-1 会把所有
中文变成乱码。真正的纯 GBK 输出会在上面的严格分支命中，不受影响。

两点容易走弯路的事实：

* ``str.decode()`` 不带参数固定用 UTF-8，与系统 locale 无关，不是本类缺陷来源；
* ``PYTHONUTF8`` / ``-X utf8`` 只影响 ``open()`` 与文件系统编码，**不影响**
  ``subprocess`` 的文本模式（后者走 ``locale.getencoding()``），所以不能靠
  环境变量兜住本类缺陷，必须在代码里显式解码。
"""

import errno
from typing import Any, List, Optional, Tuple

__all__ = [
    "decode_bytes",
    "decode_output",
    "read_text_auto",
    "read_lines_auto",
    "describe_exception",
]

# 严格解码候选（按"中文环境最常见"排序）；UTF-8 单独先试，最终兜底见 decode_bytes。
#
# 可达性说明（实测结论）：GBK/GB18030 对简体中文之外的字节序列（Big5 繁体、
# Shift_JIS 日文、EUC-KR 韩文）通常也能"严格解码成功"，只是内容是乱码；因此排在
# 其后的 big5 / shift_jis / euc-kr 实际上几乎不会被命中。保留它们只是为了"GBK 系
# 也解不开时再试一次"，不能据此认为本模块支持这些编码（详见模块 docstring）。
_ENCODING_CANDIDATES = ("gbk", "gb2312", "gb18030", "big5", "shift_jis", "euc-kr")


def decode_bytes(data: Any, encoding: Optional[str] = None) -> Tuple[str, str]:
    """把 bytes 解码为文本，返回 ``(text, used_encoding)``；**永不抛异常**。

    :param data: 待解码数据（bytes / bytearray / memoryview / str / None）
    :param encoding: 已知编码时优先用它；失败则回落级联
    """
    if data is None:
        return "", "utf-8"
    if isinstance(data, str):
        return data, "utf-8"
    if not isinstance(data, (bytes, bytearray, memoryview)):
        return str(data), "utf-8"
    data = bytes(data)
    if not data:
        return "", "utf-8"

    if encoding:
        try:
            return data.decode(encoding), encoding
        except (UnicodeDecodeError, LookupError):
            pass

    # BOM 优先（BOM 是最可靠的信号）
    if data[:3] == b"\xef\xbb\xbf":
        return data.decode("utf-8-sig", errors="replace"), "utf-8-sig"
    # 注意：utf-16-le / utf-16-be 这两个解码器**不会**剥掉 BOM，会把 U+FEFF 当普通
    # 字符保留在正文开头（内容无损但脏）。所以这里先切掉这 2 个 BOM 字节再解码。
    if data[:2] == b"\xff\xfe":
        return data[2:].decode("utf-16-le", errors="replace"), "utf-16-le"
    if data[:2] == b"\xfe\xff":
        return data[2:].decode("utf-16-be", errors="replace"), "utf-16-be"

    # 首选 UTF-8（绝大多数安全工具的输出）
    try:
        return data.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        pass

    # 其次 Windows 中文环境常见的 GBK 系（严格）
    for enc in _ENCODING_CANDIDATES:
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue

    # 最后：UTF-8 + replace —— 保住可用内容，坏字节变 U+FFFD，绝不抛异常
    return data.decode("utf-8", errors="replace"), "utf-8"


def decode_output(data: Any) -> str:
    """把子进程输出 / 文件内容（bytes / str / None）解码成 str；永不抛异常。"""
    return decode_bytes(data)[0]


def read_text_auto(path: str, encoding: Optional[str] = None) -> str:
    """按字节读取文件再用级联解码；不再因"默认编码"抛 UnicodeDecodeError。

    与 ``open(path, "r")`` 的区别：默认编码在 Windows 中文环境是 cp936，
    读到 UTF-8 内容就抛异常（常被 bare except 吞成"0 条结果"）。
    """
    with open(path, "rb") as f:
        return decode_bytes(f.read(), encoding)[0]


def read_lines_auto(path: str, encoding: Optional[str] = None) -> List[str]:
    """同 :func:`read_text_auto`，返回按行拆分的结果（统一 \\n 换行）。"""
    text = read_text_auto(path, encoding)
    if not text:
        return []
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def describe_exception(exc: Any, limit: int = 200) -> Tuple[str, str]:
    """把异常归类成 ``(一句话人话, 机器可读 kind)``；无法归类时保留类型+摘要。

    与 ``tools/native_tools._error_kind_and_text`` 口径保持一致（分类名相同），
    供外部命令链（tool_manager / unified_tool_hub / scanner）统一使用。
    """
    text = str(exc).strip() if exc is not None else ""
    low = text.lower()

    # 超时（socket.timeout 属 OSError，故先判）
    if isinstance(exc, TimeoutError) or "timed out" in low or "timeout" in low:
        return "执行超时（目标无响应或命令过慢）", "timeout"
    if isinstance(exc, FileNotFoundError) or "no such file or directory" in low:
        return "依赖的外部命令不存在（该工具未安装或路径不对）", "missing_binary"
    if isinstance(exc, PermissionError) or "permission denied" in low or "errno 13" in low:
        return "权限不足（需要更高权限，或目标拒绝访问）", "permission"
    if isinstance(exc, (UnicodeDecodeError, UnicodeError)):
        return "外部命令输出编码无法解析（已尝试按 UTF-8 / GBK 解码）", "encoding"
    if "connection refused" in low or "errno 111" in low:
        return "连接被拒绝（目标端口未监听或服务未启动）", "connection"
    if getattr(exc, "errno", None) == errno.ECONNREFUSED:
        return "连接被拒绝（目标端口未监听或服务未启动）", "connection"
    if isinstance(exc, ConnectionError):
        return "连接失败（目标不可达或网络被拦截）", "connection"
    if isinstance(exc, KeyboardInterrupt) or "cancelled" in low or "canceled" in low:
        return "执行已取消", "cancelled"

    name = type(exc).__name__ if exc is not None else "Error"
    if text:
        return f"执行失败（{name}）：{text[:limit]}", "internal"
    return f"执行失败（{name}，无错误信息）", "internal"