"""异常定义。"""

from typing import Any, Dict, Optional

class LibertasError(Exception):
    """Libertas 系统基础异常"""

    ERROR_CODE = "E0000"
    ERROR_NAME = "LibertasError"
    DEFAULT_MESSAGE = "系统内部错误"

    def __init__(self, message: str = "", code: str = "", recoverable: bool = True,
                 context: Optional[Dict[str, Any]] = None, cause: Optional[Exception] = None):
        self.message = message or self.DEFAULT_MESSAGE
        self.code = code or self.ERROR_CODE
        self.recoverable = recoverable
        self.context = context or {}
        self.cause = cause
        super().__init__(self.message)

    def __str__(self) -> str:
        parts = [f"[{self.code}] {self.message}"]
        if self.context:
            ctx_str = ", ".join(f"{k}={v}" for k, v in self.context.items())
            parts.append(f"({ctx_str})")
        if self.cause:
            parts.append(f"caused by: {self.cause}")
        return " ".join(parts)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "name": self.ERROR_NAME,
            "message": self.message,
            "recoverable": self.recoverable,
            "context": self.context,
        }
