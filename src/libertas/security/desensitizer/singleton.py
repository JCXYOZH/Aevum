"""脱敏器单例与模块级入口。"""

from typing import Any, Dict, List

from .core import Desensitizer

_desensitizer = Desensitizer()

def get_desensitizer() -> Desensitizer:
    return _desensitizer

def desensitize(text: str, **kwargs) -> str:
    return _desensitizer.desensitize(text, **kwargs)

def desensitize_dict(data: Dict[str, Any], **kwargs) -> Dict[str, Any]:
    return _desensitizer.desensitize_dict(data, **kwargs)

def detect_sensitive(text: str) -> List[Dict[str, Any]]:
    return _desensitizer.detect_sensitive(text)
