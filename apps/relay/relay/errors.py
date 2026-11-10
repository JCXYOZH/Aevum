# ============================================================
# relay/errors.py — 失败的类型化表示（DAG 第 1 层）
#
# 目的：让“导入失败 / 层级违规 / 契约冲突”这类问题不再是黑盒崩溃，
# 而是带着 0xRRFFTT 和“哪个模块、哪一行、缺什么”一起冒出来。
#
# 依赖：只依赖第 0 层的 codes。
# ============================================================
from __future__ import annotations

from typing import Dict, Optional

from relay.codes import error_hex, error_message, error_name


class RelayFault(RuntimeError):
    """带错误码的失败。所有主动报错都走这里，避免散落字符串。"""

    def __init__(self, code: int, detail: str, *, subject: str = "") -> None:
        self.code = code
        self.detail = str(detail)
        self.subject = str(subject)
        super().__init__(self.render())

    def render(self) -> str:
        parts = [error_hex(self.code), error_name(self.code)]
        if self.subject:
            parts.append(f"@{self.subject}")
        parts.append("::")
        parts.append(error_message(self.code))
        if self.detail:
            parts.append(f"— {self.detail}")
        return " ".join(parts)

    def as_dict(self) -> Dict[str, object]:
        return {
            "ok": False,
            "code": error_hex(self.code),
            "name": error_name(self.code),
            "message": error_message(self.code),
            "subject": self.subject,
            "detail": self.detail,
        }


def fault(code: int, detail: str, subject: Optional[str] = None) -> RelayFault:
    return RelayFault(code, detail, subject=subject or "")
