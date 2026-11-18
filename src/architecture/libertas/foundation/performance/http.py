"""职责模块：http。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, TypeVar
import threading

from .state import _http_session
from .state import _http_session_lock

class LazyLoader:
    """延迟导入模块，首次访问时才真正 import。"""
    def __init__(self):
        self._modules: Dict[str, Any] = {}
        self._lock = threading.Lock()

    def require(self, module_name: str) -> Any:
        if module_name in self._modules:
            return self._modules[module_name]
        with self._lock:
            if module_name not in self._modules:
                self._modules[module_name] = __import__(module_name, fromlist=["_"])
            return self._modules[module_name]

    def require_attr(self, module_name: str, attr: str) -> Any:
        mod = self.require(module_name)
        return getattr(mod, attr)

lazy = LazyLoader()

def get_http_session(pool_size: int = 32):
    """获取带连接池的 requests.Session。"""
    global _http_session
    if _http_session is not None:
        return _http_session
    with _http_session_lock:
        if _http_session is None:
            try:
                import requests
                from requests.adapters import HTTPAdapter
                try:
                    from urllib3.util.retry import Retry
                    retry = Retry(total=2, backoff_factor=0.3,
                                  status_forcelist=[500, 502, 503, 504])
                except Exception:
                    retry = 0
                session = requests.Session()
                adapter = HTTPAdapter(
                    pool_connections=pool_size,
                    pool_maxsize=pool_size,
                    max_retries=retry,
                    pool_block=False,
                )
                session.mount("http://", adapter)
                session.mount("https://", adapter)
                session.headers.update({"Connection": "keep-alive"})
                _http_session = session
            except ImportError:
                _http_session = None
    return _http_session
